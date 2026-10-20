import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../src/config.js";
import { DEMO_TODAY, demoWeather } from "../src/demo.js";
import { runGarden } from "../src/pipeline.js";

test("demo weather is fixed and complete", () => {
  const cache = demoWeather();
  assert.equal(cache.daily.time.length, 21);
  assert.equal(cache.daily.time[0], "2026-10-07");
  assert.equal(cache.daily.time[20], "2026-10-27");
  assert.equal(cache.soilMoisture?.value, 0.23);
  assert.equal(DEMO_TODAY, "2026-10-21");
});

test("demo shows one zone that needs water", () => {
  const config = defaultConfig();
  const garden = runGarden(config, demoWeather(), [], {
    today: DEMO_TODAY,
    rainLookaheadDays: 2,
  });
  const toms = garden.runs.find((run) => run.zone.id === "toms");
  const herbs = garden.runs.find((run) => run.zone.id === "herbs");
  assert.equal(toms?.advice.verdict, "water");
  assert.equal(herbs?.advice.verdict, "ok");
  assert.equal(toms?.advice.minutes, 117);
  assert.ok(garden.modelNote.includes("calibrated"));
});