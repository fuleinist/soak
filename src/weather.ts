/**
 * Open-Meteo client.
 *
 * Reads daily ET0 and precipitation plus the latest soil moisture reading.
 * Base service: https://api.open-meteo.com/v1/forecast (verified 2026-10-21).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isIsoDate, isoNow } from "./util.js";

export const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
export const DEFAULT_PAST_DAYS = 14;
export const DEFAULT_FORECAST_DAYS = 7;

export interface DailySeries {
  time: string[];
  et0: (number | null)[];
  precipitation: (number | null)[];
}

export interface SoilMoistureReading {
  time: string;
  /** Volumetric water content in m³/m³ at 1-3 cm depth. */
  value: number;
}

export interface WeatherCache {
  fetchedAt: string;
  latitude: number;
  longitude: number;
  timezone: string;
  daily: DailySeries;
  soilMoisture: SoilMoistureReading | null;
  /** Count of null values across the daily series. */
  missingValues: number;
}

export interface FetchWeatherOptions {
  pastDays?: number;
  forecastDays?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export function buildForecastUrl(
  latitude: number,
  longitude: number,
  options: { pastDays?: number; forecastDays?: number; base?: string } = {},
): string {
  const base = options.base ?? OPEN_METEO_BASE;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: "et0_fao_evapotranspiration,precipitation_sum",
    timezone: "auto",
    past_days: String(options.pastDays ?? DEFAULT_PAST_DAYS),
    forecast_days: String(options.forecastDays ?? DEFAULT_FORECAST_DAYS),
  });
  return `${base}?${params.toString()}`;
}

export function buildSoilMoistureUrl(
  latitude: number,
  longitude: number,
  options: { base?: string } = {},
): string {
  const base = options.base ?? OPEN_METEO_BASE;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "soil_moisture_1_to_3cm",
    timezone: "auto",
    past_days: "1",
    forecast_days: "1",
  });
  return `${base}?${params.toString()}`;
}

function asNumberOrNull(value: unknown, context: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`unexpected value in ${context}: ${String(value)}`);
  }
  return value;
}

export interface ParsedForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: DailySeries;
  missingValues: number;
}

export function parseForecastPayload(data: unknown): ParsedForecast {
  if (typeof data !== "object" || data === null) {
    throw new Error("forecast payload must be an object");
  }
  const payload = data as {
    latitude?: unknown;
    longitude?: unknown;
    timezone?: unknown;
    daily?: { time?: unknown; et0_fao_evapotranspiration?: unknown; precipitation_sum?: unknown };
  };
  if (typeof payload.latitude !== "number" || typeof payload.longitude !== "number") {
    throw new Error("forecast payload is missing coordinates");
  }
  if (typeof payload.timezone !== "string" || payload.timezone.length === 0) {
    throw new Error("forecast payload is missing a timezone");
  }
  const daily = payload.daily;
  if (typeof daily !== "object" || daily === null) {
    throw new Error("forecast payload is missing daily values");
  }
  const time = daily.time;
  const et0Raw = daily.et0_fao_evapotranspiration;
  const precipRaw = daily.precipitation_sum;
  if (
    !Array.isArray(time) ||
    time.length === 0 ||
    !time.every((d) => typeof d === "string" && isIsoDate(d))
  ) {
    throw new Error("forecast payload has a bad daily time array");
  }
  if (!Array.isArray(et0Raw) || !Array.isArray(precipRaw)) {
    throw new Error("forecast payload is missing daily value arrays");
  }
  if (et0Raw.length !== time.length || precipRaw.length !== time.length) {
    throw new Error("forecast payload arrays have different lengths");
  }
  const et0 = et0Raw.map((v) => asNumberOrNull(v, "daily et0"));
  const precipitation = precipRaw.map((v) => asNumberOrNull(v, "daily precipitation"));
  const missingValues =
    et0.filter((v) => v === null).length + precipitation.filter((v) => v === null).length;
  return {
    latitude: payload.latitude,
    longitude: payload.longitude,
    timezone: payload.timezone,
    daily: { time: time as string[], et0, precipitation },
    missingValues,
  };
}

export function parseSoilMoisturePayload(data: unknown): SoilMoistureReading | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const hourly = (data as { hourly?: { time?: unknown; soil_moisture_1_to_3cm?: unknown } }).hourly;
  if (typeof hourly !== "object" || hourly === null) {
    return null;
  }
  const time = hourly.time;
  const values = hourly.soil_moisture_1_to_3cm;
  if (!Array.isArray(time) || !Array.isArray(values)) {
    return null;
  }
  for (let i = Math.min(time.length, values.length) - 1; i >= 0; i -= 1) {
    const value = values[i];
    const t = time[i];
    if (typeof value === "number" && Number.isFinite(value) && typeof t === "string") {
      return { time: t, value };
    }
  }
  return null;
}

async function fetchJson(url: string, fetchImpl: typeof fetch, label: string): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from Open-Meteo ${label}`);
  }
  return res.json();
}

export async function fetchWeather(
  latitude: number,
  longitude: number,
  options: FetchWeatherOptions = {},
): Promise<WeatherCache> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();

  const forecastPromise = fetchJson(
    buildForecastUrl(latitude, longitude, options),
    fetchImpl,
    "forecast",
  );
  const soilPromise = fetchJson(
    buildSoilMoistureUrl(latitude, longitude),
    fetchImpl,
    "soil moisture",
  ).catch(() => null);

  let forecastData: unknown;
  try {
    forecastData = await forecastPromise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`weather fetch failed: ${message}`);
  }
  const soilData = await soilPromise;

  const parsed = parseForecastPayload(forecastData);
  const soilMoisture = soilData === null ? null : parseSoilMoisturePayload(soilData);

  return {
    fetchedAt: isoNow(now),
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    timezone: parsed.timezone,
    daily: parsed.daily,
    soilMoisture,
    missingValues: parsed.missingValues,
  };
}

export function weatherCachePath(dataDir: string): string {
  return join(dataDir, "cache", "weather.json");
}

export function saveWeatherCache(cache: WeatherCache, dataDir: string): string {
  const path = weatherCachePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2));
  return path;
}

export function loadWeatherCache(dataDir: string): WeatherCache | null {
  const path = weatherCachePath(dataDir);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data !== "object" || data === null) {
      return null;
    }
    const cache = data as WeatherCache;
    if (
      typeof cache.fetchedAt !== "string" ||
      typeof cache.timezone !== "string" ||
      typeof cache.latitude !== "number" ||
      typeof cache.longitude !== "number" ||
      typeof cache.daily !== "object" ||
      cache.daily === null ||
      !Array.isArray(cache.daily.time)
    ) {
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

export function ageInHours(fetchedAt: string, now: Date = new Date()): number {
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) {
    return Number.POSITIVE_INFINITY;
  }
  return (now.getTime() - t) / 3_600_000;
}

export function isWeatherFresh(
  cache: WeatherCache,
  cacheHours: number,
  now: Date = new Date(),
): boolean {
  return ageInHours(cache.fetchedAt, now) <= cacheHours;
}

export interface DailyWeather {
  date: string;
  et0Mm: number;
  rainMm: number;
}

export function toDailyWeather(cache: WeatherCache): DailyWeather[] {
  return cache.daily.time.map((date, index) => ({
    date,
    et0Mm: cache.daily.et0[index] ?? 0,
    rainMm: cache.daily.precipitation[index] ?? 0,
  }));
}

export function weatherRange(cache: WeatherCache): { start: string; end: string } | null {
  const time = cache.daily.time;
  if (time.length === 0) {
    return null;
  }
  return { start: time[0], end: time[time.length - 1] };
}