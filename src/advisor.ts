/**
 * Advice engine: turns the water balance into clear actions.
 */
import type { ZoneConfig } from "./config.js";
import { clamp, formatMm, round1 } from "./util.js";
import {
  effectiveRainMm,
  effectiveRainSum,
  etcMm,
  madMm,
  pawMm,
  stateBefore,
  wateringLitres,
  wateringMinutes,
  type BalanceRow,
} from "./water.js";
import type { DailyWeather } from "./weather.js";

export type Verdict = "water" | "wait" | "soon" | "ok";

export const VERDICT_LABELS: Record<Verdict, string> = {
  water: "WATER NOW",
  wait: "WAIT FOR RAIN",
  soon: "WATER SOON",
  ok: "OK",
};

/** Below this amount, watering is not worth the effort. */
export const MIN_USEFUL_MM = 2;
/** The "soon" band starts at this fraction of MAD. */
export const SOON_FRACTION = 0.8;

export interface Decision {
  verdict: Verdict;
  /** Recommended water amount in mm (verdict "water" only). */
  needMm?: number;
  /** Minutes to apply the amount (verdict "water" only). */
  minutes?: number;
  /** Litres over the bed area, or null when areaM2 is unknown. */
  litres?: number | null;
  reason: string;
}

export function decideAction(
  zone: ZoneConfig,
  deficitMm: number,
  rainSumMm: number,
): Decision {
  const mad = madMm(zone);
  if (deficitMm >= mad) {
    if (rainSumMm >= deficitMm) {
      return { verdict: "wait", reason: `rain covers the deficit (${formatMm(rainSumMm)} expected)` };
    }
    const need = deficitMm - rainSumMm;
    if (need < MIN_USEFUL_MM) {
      return {
        verdict: "wait",
        reason: `rain nearly covers the deficit (${formatMm(rainSumMm)} expected)`,
      };
    }
    const paw = pawMm(zone);
    const pct = paw === 0 ? 100 : Math.round((deficitMm / paw) * 100);
    return {
      verdict: "water",
      needMm: need,
      minutes: wateringMinutes(zone, need),
      litres: wateringLitres(zone, need),
      reason: `soil is ${pct}% depleted and rain will not cover it`,
    };
  }
  if (deficitMm >= SOON_FRACTION * mad) {
    return { verdict: "soon", reason: "check again tomorrow" };
  }
  return { verdict: "ok", reason: "no action needed" };
}

export interface AdviceOptions {
  /** Garden-local date, YYYY-MM-DD. */
  today: string;
  rainLookaheadDays: number;
}

export interface ZoneAdvice extends Decision {
  zoneId: string;
  zoneName: string;
  /** Last completed day used for the state. */
  stateDate: string;
  deficitMm: number;
  depletion: number;
  depletionPct: number;
  pawMm: number;
  madMm: number;
  rainSumMm: number;
  lookaheadDays: number;
}

export function adviseZone(
  zone: ZoneConfig,
  rows: BalanceRow[],
  days: DailyWeather[],
  options: AdviceOptions,
): ZoneAdvice {
  const state = stateBefore(zone, rows, options.today);
  if (state === null) {
    throw new Error(`weather window does not cover ${options.today}; run fetch first`);
  }
  const rainSum = effectiveRainSum(days, options.today, options.rainLookaheadDays);
  const decision = decideAction(zone, state.deficitMm, rainSum);
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    stateDate: state.date,
    deficitMm: state.deficitMm,
    depletion: state.depletion,
    depletionPct: Math.round(state.depletion * 100),
    pawMm: pawMm(zone),
    madMm: madMm(zone),
    rainSumMm: rainSum,
    lookaheadDays: options.rainLookaheadDays,
    ...decision,
  };
}

export interface PlanEntry extends Decision {
  date: string;
  /** State at the start of the day. */
  deficitMm: number;
  rainSumMm: number;
}

export interface ZonePlan {
  zoneId: string;
  zoneName: string;
  entries: PlanEntry[];
}

export function planZone(
  zone: ZoneConfig,
  rows: BalanceRow[],
  days: DailyWeather[],
  options: AdviceOptions,
): ZonePlan {
  const start = stateBefore(zone, rows, options.today);
  if (start === null) {
    return { zoneId: zone.id, zoneName: zone.name, entries: [] };
  }
  const paw = pawMm(zone);
  let state = start.deficitMm;
  const entries: PlanEntry[] = [];
  for (const day of days) {
    if (day.date < options.today) {
      continue;
    }
    const rainSum = effectiveRainSum(days, day.date, options.rainLookaheadDays);
    const decision = decideAction(zone, state, rainSum);
    entries.push({
      date: day.date,
      deficitMm: state,
      rainSumMm: round1(rainSum),
      ...decision,
    });
    // The plan assumes the gardener follows the advice.
    const watering = decision.verdict === "water" ? (decision.needMm ?? 0) : 0;
    state = clamp(state + etcMm(zone, day.et0Mm) - effectiveRainMm(day.rainMm) - watering, 0, paw);
  }
  return { zoneId: zone.id, zoneName: zone.name, entries };
}