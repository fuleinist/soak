/**
 * Offline demo: bundled sample garden and weather for 2026-10-21.
 */
import { defaultConfig, type SoakConfig } from "./config.js";
import type { WeatherCache } from "./weather.js";

export const DEMO_TODAY = "2026-10-21";

/** Sample daily weather: 14 past days + 7 forecast days. */
const DEMO_DAYS: Array<{ date: string; et0: number; rain: number }> = [
  { date: "2026-10-07", et0: 4.5, rain: 0 },
  { date: "2026-10-08", et0: 5.0, rain: 0 },
  { date: "2026-10-09", et0: 4.0, rain: 0 },
  { date: "2026-10-10", et0: 4.5, rain: 0 },
  { date: "2026-10-11", et0: 5.0, rain: 0 },
  { date: "2026-10-12", et0: 6.0, rain: 0 },
  { date: "2026-10-13", et0: 6.5, rain: 0 },
  { date: "2026-10-14", et0: 5.5, rain: 0 },
  { date: "2026-10-15", et0: 5.0, rain: 18 },
  { date: "2026-10-16", et0: 6.0, rain: 0 },
  { date: "2026-10-17", et0: 6.5, rain: 0 },
  { date: "2026-10-18", et0: 6.0, rain: 0 },
  { date: "2026-10-19", et0: 6.5, rain: 0 },
  { date: "2026-10-20", et0: 7.0, rain: 0 },
  { date: "2026-10-21", et0: 6.5, rain: 0 },
  { date: "2026-10-22", et0: 5.5, rain: 0 },
  { date: "2026-10-23", et0: 6.0, rain: 25 },
  { date: "2026-10-24", et0: 5.0, rain: 3 },
  { date: "2026-10-25", et0: 5.5, rain: 0 },
  { date: "2026-10-26", et0: 6.0, rain: 0 },
  { date: "2026-10-27", et0: 6.0, rain: 0 },
];

export function demoConfig(): SoakConfig {
  return defaultConfig();
}

export function demoWeather(): WeatherCache {
  return {
    fetchedAt: "2026-10-20T19:00:00.000Z",
    latitude: -33.7254,
    longitude: 151.0487,
    timezone: "Australia/Sydney",
    daily: {
      time: DEMO_DAYS.map((day) => day.date),
      et0: DEMO_DAYS.map((day) => day.et0),
      precipitation: DEMO_DAYS.map((day) => day.rain),
    },
    soilMoisture: { time: "2026-10-21T00:00", value: 0.23 },
    missingValues: 0,
  };
}