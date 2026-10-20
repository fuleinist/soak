/**
 * Root-zone water balance model.
 *
 * A bucket per zone: ET0 × kc drains it, rain and waterings fill it.
 */
import {
  effectiveKc,
  effectiveMaxDepletion,
  effectiveWatering,
  isMulched,
  MULCH_FACTOR,
  type ZoneConfig,
} from "./config.js";
import { awcMmPerM, isSoilType, SOIL_PROPERTIES } from "./soils.js";
import { addDays, clamp } from "./util.js";
import type { DailyWeather } from "./weather.js";

/** Fraction of rain that reaches the root zone. */
export const EFFECTIVE_RAIN_FACTOR = 0.8;

export function pawMm(zone: ZoneConfig): number {
  if (!isSoilType(zone.soil)) {
    throw new Error(`unknown soil type: ${zone.soil}`);
  }
  return awcMmPerM(zone.soil) * zone.rootDepthM;
}

export function madMm(zone: ZoneConfig): number {
  return effectiveMaxDepletion(zone) * pawMm(zone);
}

export function etcMm(zone: ZoneConfig, et0Mm: number): number {
  return et0Mm * effectiveKc(zone) * (isMulched(zone) ? MULCH_FACTOR : 1);
}

export function effectiveRainMm(rainMm: number): number {
  return rainMm * EFFECTIVE_RAIN_FACTOR;
}

/**
 * Seed deficit from a soil moisture reading (1-3 cm layer, m³/m³).
 * Returns 0 when no reading exists (assume a full profile).
 */
export function seedDeficitMm(zone: ZoneConfig, soilMoisture?: number | null): number {
  const paw = pawMm(zone);
  if (soilMoisture === undefined || soilMoisture === null || !isSoilType(zone.soil)) {
    return 0;
  }
  const props = SOIL_PROPERTIES[zone.soil];
  const span = props.fieldCapacity - props.wiltingPoint;
  const sRel = clamp((soilMoisture - props.wiltingPoint) / span, 0, 1);
  return (1 - sRel) * paw;
}

/** Rounded-up minutes to apply `needMm` through the zone's watering system. */
export function wateringMinutes(zone: ZoneConfig, needMm: number): number {
  const { precipRateMmPerHour, efficiency } = effectiveWatering(zone);
  return Math.ceil((needMm / efficiency / precipRateMmPerHour) * 60);
}

/** Litres needed over the zone area, or null when areaM2 is unknown. */
export function wateringLitres(zone: ZoneConfig, needMm: number): number | null {
  if (zone.areaM2 === undefined) {
    return null;
  }
  return needMm * zone.areaM2;
}

/** Millimetres applied by a watering of the given length. */
export function appliedMmFromMinutes(zone: ZoneConfig, minutes: number): number {
  const { precipRateMmPerHour, efficiency } = effectiveWatering(zone);
  return (minutes / 60) * precipRateMmPerHour * efficiency;
}

export interface BalanceRow {
  date: string;
  et0Mm: number;
  etcMm: number;
  rainMm: number;
  effRainMm: number;
  wateringMm: number;
  deficitMm: number;
  /** Deficit as a fraction of PAW (0-1). */
  depletion: number;
}

export interface Recalibration {
  /** End of this day: the deficit is reset to deficitMm. */
  date: string;
  deficitMm: number;
}

export function simulateZone(
  zone: ZoneConfig,
  days: DailyWeather[],
  wateringsByDate: Record<string, number>,
  seedMm: number,
  recalibration?: Recalibration,
): BalanceRow[] {
  const paw = pawMm(zone);
  let deficit = clamp(seedMm, 0, paw);
  const rows: BalanceRow[] = [];
  for (const day of days) {
    const etc = etcMm(zone, day.et0Mm);
    const effRain = effectiveRainMm(day.rainMm);
    const watering = wateringsByDate[day.date] ?? 0;
    deficit = clamp(deficit + etc - effRain - watering, 0, paw);
    if (recalibration && day.date === recalibration.date) {
      deficit = clamp(recalibration.deficitMm, 0, paw);
    }
    rows.push({
      date: day.date,
      et0Mm: day.et0Mm,
      etcMm: etc,
      rainMm: day.rainMm,
      effRainMm: effRain,
      wateringMm: watering,
      deficitMm: deficit,
      depletion: paw === 0 ? 0 : deficit / paw,
    });
  }
  return rows;
}

export interface ZoneState {
  /** The last completed day used for the state. */
  date: string;
  deficitMm: number;
  depletion: number;
}

/** State at the start of `date` (end of the previous day), or null when unknown. */
export function stateBefore(
  zone: ZoneConfig,
  rows: BalanceRow[],
  date: string,
): ZoneState | null {
  let found: BalanceRow | null = null;
  for (const row of rows) {
    if (row.date < date) {
      found = row;
    } else {
      break;
    }
  }
  if (found === null) {
    return null;
  }
  const paw = pawMm(zone);
  return {
    date: found.date,
    deficitMm: found.deficitMm,
    depletion: paw === 0 ? 0 : found.deficitMm / paw,
  };
}

/** Effective rain over the N days that start at `startDate`. */
export function effectiveRainSum(
  days: DailyWeather[],
  startDate: string,
  lookaheadDays: number,
): number {
  const end = addDays(startDate, lookaheadDays);
  let sum = 0;
  for (const day of days) {
    if (day.date >= startDate && day.date < end) {
      sum += effectiveRainMm(day.rainMm);
    }
  }
  return sum;
}