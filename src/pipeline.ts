/**
 * Pipeline: ties weather, waterings, and the model together for CLI commands.
 */
import { adviseZone, planZone, type AdviceOptions, type ZoneAdvice, type ZonePlan } from "./advisor.js";
import type { SoakConfig, ZoneConfig } from "./config.js";
import { addDays, round2 } from "./util.js";
import { seedDeficitMm, simulateZone, type BalanceRow } from "./water.js";
import { wateringsByDate, type WateringEvent } from "./waterings.js";
import { toDailyWeather, type DailyWeather, type WeatherCache } from "./weather.js";

export interface ZoneRun {
  zone: ZoneConfig;
  rows: BalanceRow[];
  advice: ZoneAdvice;
}

export interface GardenRun {
  days: DailyWeather[];
  runs: ZoneRun[];
  modelNote: string;
}

export function modelNoteFor(cache: WeatherCache): string {
  const reading = cache.soilMoisture;
  if (reading) {
    return `deficit calibrated to the soil moisture reading (${round2(reading.value)} m³/m³)`;
  }
  return "full profile assumed at the start of the history window";
}

export function runGarden(
  config: SoakConfig,
  cache: WeatherCache,
  events: WateringEvent[],
  options: AdviceOptions,
): GardenRun {
  const days = toDailyWeather(cache);
  const reading = cache.soilMoisture;
  const runs: ZoneRun[] = config.zones.map((zone) => {
    const recalibration = reading
      ? { date: addDays(options.today, -1), deficitMm: seedDeficitMm(zone, reading.value) }
      : undefined;
    const rows = simulateZone(zone, days, wateringsByDate(events, zone.id), 0, recalibration);
    const advice = adviseZone(zone, rows, days, options);
    return { zone, rows, advice };
  });
  return { days, runs, modelNote: modelNoteFor(cache) };
}

export function planGarden(
  runs: ZoneRun[],
  days: DailyWeather[],
  options: AdviceOptions,
): ZonePlan[] {
  return runs.map((run) => planZone(run.zone, run.rows, days, options));
}