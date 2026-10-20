import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildForecastUrl,
  buildSoilMoistureUrl,
  fetchWeather,
  isWeatherFresh,
  loadWeatherCache,
  parseForecastPayload,
  parseSoilMoisturePayload,
  saveWeatherCache,
  toDailyWeather,
  weatherRange,
  type WeatherCache,
} from "../src/weather.js";

const FORECAST_FIXTURE = {
  latitude: -33.7,
  longitude: 151.0,
  timezone: "Australia/Sydney",
  utc_offset_seconds: 39600,
  daily: {
    time: ["2026-10-20", "2026-10-21", "2026-10-22"],
    et0_fao_evapotranspiration: [3.5, 4.0, null],
    precipitation_sum: [0, 2.4, 5.0],
  },
};

const SOIL_FIXTURE = {
  hourly: {
    time: ["2026-10-20T00:00", "2026-10-20T12:00", "2026-10-21T00:00"],
    soil_moisture_1_to_3cm: [0.18, null, 0.21],
  },
};

function fakeJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function makeCache(overrides: Partial<WeatherCache> = {}): WeatherCache {
  return {
    fetchedAt: "2026-10-20T19:00:00.000Z",
    latitude: -33.7,
    longitude: 151.0,
    timezone: "Australia/Sydney",
    daily: { time: ["2026-10-20", "2026-10-21"], et0: [3.5, null], precipitation: [0, 2.4] },
    soilMoisture: null,
    missingValues: 1,
    ...overrides,
  };
}

test("buildForecastUrl encodes the request", () => {
  const url = new URL(buildForecastUrl(-33.7, 151.0));
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("latitude"), "-33.7");
  assert.equal(url.searchParams.get("longitude"), "151");
  assert.equal(url.searchParams.get("daily"), "et0_fao_evapotranspiration,precipitation_sum");
  assert.equal(url.searchParams.get("timezone"), "auto");
  assert.equal(url.searchParams.get("past_days"), "14");
  assert.equal(url.searchParams.get("forecast_days"), "7");
});

test("buildForecastUrl accepts custom windows", () => {
  const url = new URL(buildForecastUrl(1.5, 2.5, { pastDays: 3, forecastDays: 2 }));
  assert.equal(url.searchParams.get("past_days"), "3");
  assert.equal(url.searchParams.get("forecast_days"), "2");
});

test("buildSoilMoistureUrl requests the 1-3 cm layer", () => {
  const url = new URL(buildSoilMoistureUrl(-33.7, 151.0));
  assert.equal(url.searchParams.get("hourly"), "soil_moisture_1_to_3cm");
  assert.equal(url.searchParams.get("past_days"), "1");
  assert.equal(url.searchParams.get("forecast_days"), "1");
});

test("parseForecastPayload reads a healthy payload", () => {
  const parsed = parseForecastPayload(FORECAST_FIXTURE);
  assert.equal(parsed.timezone, "Australia/Sydney");
  assert.equal(parsed.latitude, -33.7);
  assert.deepEqual(parsed.daily.time, ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.deepEqual(parsed.daily.et0, [3.5, 4.0, null]);
  assert.equal(parsed.missingValues, 1);
});

test("parseForecastPayload rejects bad payloads", () => {
  assert.throws(() => parseForecastPayload(null), /object/);
  assert.throws(() => parseForecastPayload({}), /coordinates/);
  assert.throws(
    () => parseForecastPayload({ latitude: 1, longitude: 2, timezone: "UTC" }),
    /daily/,
  );
  assert.throws(
    () =>
      parseForecastPayload({
        latitude: 1,
        longitude: 2,
        timezone: "UTC",
        daily: { time: ["not-a-date"], et0_fao_evapotranspiration: [1], precipitation_sum: [1] },
      }),
    /time array/,
  );
  assert.throws(
    () =>
      parseForecastPayload({
        latitude: 1,
        longitude: 2,
        timezone: "UTC",
        daily: {
          time: ["2026-10-20", "2026-10-21"],
          et0_fao_evapotranspiration: [1],
          precipitation_sum: [1, 2],
        },
      }),
    /lengths/,
  );
});

test("parseSoilMoisturePayload picks the latest reading", () => {
  const reading = parseSoilMoisturePayload(SOIL_FIXTURE);
  assert.deepEqual(reading, { time: "2026-10-21T00:00", value: 0.21 });
});

test("parseSoilMoisturePayload handles empty data", () => {
  assert.equal(parseSoilMoisturePayload(null), null);
  assert.equal(parseSoilMoisturePayload({}), null);
  assert.equal(
    parseSoilMoisturePayload({
      hourly: { time: ["2026-10-20T00:00"], soil_moisture_1_to_3cm: [null] },
    }),
    null,
  );
});

test("cache save and load round trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "soak-weather-"));
  const cache = makeCache({ soilMoisture: { time: "2026-10-20T00:00", value: 0.2 } });
  const path = saveWeatherCache(cache, dir);
  assert.ok(path.endsWith("weather.json"));
  const loaded = loadWeatherCache(dir);
  assert.deepEqual(loaded, cache);
});

test("cache load tolerates missing or broken files", () => {
  const dir = mkdtempSync(join(tmpdir(), "soak-weather-"));
  assert.equal(loadWeatherCache(dir), null);
  mkdirSync(join(dir, "cache"), { recursive: true });
  const path = join(dir, "cache", "weather.json");
  writeFileSync(path, "{ nope");
  assert.equal(loadWeatherCache(dir), null);
  writeFileSync(path, JSON.stringify({ fetchedAt: 5 }));
  assert.equal(loadWeatherCache(dir), null);
});

test("isWeatherFresh compares age to the limit", () => {
  const cache = makeCache();
  const now = new Date("2026-10-21T00:00:00.000Z"); // 5 hours after fetchedAt
  assert.equal(isWeatherFresh(cache, 6, now), true);
  assert.equal(isWeatherFresh(cache, 4, now), false);
});

test("toDailyWeather maps nulls to zero", () => {
  const days = toDailyWeather(makeCache());
  assert.deepEqual(days, [
    { date: "2026-10-20", et0Mm: 3.5, rainMm: 0 },
    { date: "2026-10-21", et0Mm: 0, rainMm: 2.4 },
  ]);
});

test("weatherRange reports the covered dates", () => {
  assert.deepEqual(weatherRange(makeCache()), { start: "2026-10-20", end: "2026-10-21" });
  assert.equal(weatherRange(makeCache({ daily: { time: [], et0: [], precipitation: [] } })), null);
});

test("fetchWeather merges forecast and soil moisture", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("soil_moisture")) {
      return fakeJson(SOIL_FIXTURE);
    }
    return fakeJson(FORECAST_FIXTURE);
  }) as unknown as typeof fetch;
  const cache = await fetchWeather(-33.7, 151.0, {
    fetchImpl: fakeFetch,
    now: new Date("2026-10-21T06:00:00+11:00"),
  });
  assert.equal(calls.length, 2);
  assert.equal(cache.timezone, "Australia/Sydney");
  assert.deepEqual(cache.soilMoisture, { time: "2026-10-21T00:00", value: 0.21 });
  assert.equal(cache.fetchedAt, "2026-10-20T19:00:00.000Z");
  assert.equal(cache.missingValues, 1);
});

test("fetchWeather keeps the forecast when soil moisture fails", async () => {
  const fakeFetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("soil_moisture")) {
      return fakeJson({ error: true }, 500);
    }
    return fakeJson(FORECAST_FIXTURE);
  }) as unknown as typeof fetch;
  const cache = await fetchWeather(-33.7, 151.0, { fetchImpl: fakeFetch });
  assert.equal(cache.soilMoisture, null);
  assert.equal(cache.daily.time.length, 3);
});

test("fetchWeather fails when the forecast fails", async () => {
  const fakeFetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("soil_moisture")) {
      return fakeJson(SOIL_FIXTURE);
    }
    return fakeJson({ error: true }, 500);
  }) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchWeather(-33.7, 151.0, { fetchImpl: fakeFetch }),
    /HTTP 500 from Open-Meteo forecast/,
  );
});

test("fetchWeather reports network errors clearly", async () => {
  const fakeFetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(() => fetchWeather(0, 0, { fetchImpl: fakeFetch }), /weather fetch failed/);
});