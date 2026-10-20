import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../src/config.js";
import { planGarden, runGarden } from "../src/pipeline.js";
import type { WeatherCache } from "../src/weather.js";

function cache(overrides: Partial<WeatherCache> = {}): WeatherCache {
  return {
    fetchedAt: "2026-10-20T19:00:00.000Z",
    latitude: -33.7,
    longitude: 151.0,
    timezone: "Australia/Sydney",
    daily: {
      time: ["2026-10-19", "2026-10-20", "2026-10-21"],
      et0: [6, 6, 6],
      precipitation: [0, 0, 0],
    },
    soilMoisture: null,
    missingValues: 0,
    ...overrides,
  };
}

const options = { today: "2026-10-21", rainLookaheadDays: 2 };

function approx(actual: number, expected: number, eps = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected} ± ${eps}, got ${actual}`);
}

test("runGarden notes a full-profile start without a reading", () => {
  const config = defaultConfig();
  const garden = runGarden(config, cache(), [], options);
  assert.equal(garden.runs.length, 2);
  assert.equal(garden.modelNote, "full profile assumed at the start of the history window");
  assert.equal(garden.days.length, 3);
});

test("runGarden calibrates to a soil moisture reading", () => {
  const config = defaultConfig();
  const garden = runGarden(
    config,
    cache({ soilMoisture: { time: "2026-10-21T00:00", value: 0.12 } }),
    [],
    options,
  );
  assert.ok(garden.modelNote.includes("calibrated to the soil moisture reading"));
  const herbs = garden.runs.find((run) => run.zone.id === "herbs");
  assert.equal(herbs?.advice.verdict, "water"); // deficit reset to ~12 mm, above MAD
  approx(herbs?.advice.needMm ?? -1, 12, 1e-6);
});

test("planGarden returns one plan per zone", () => {
  const config = defaultConfig();
  const garden = runGarden(config, cache(), [], options);
  const plans = planGarden(garden.runs, garden.days, options);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].entries.length, 1); // one forecast day
  assert.equal(plans[0].entries[0].date, "2026-10-21");
});