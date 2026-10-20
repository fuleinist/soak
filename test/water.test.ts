import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig, type ZoneConfig } from "../src/config.js";
import {
  appliedMmFromMinutes,
  effectiveRainMm,
  effectiveRainSum,
  etcMm,
  madMm,
  pawMm,
  seedDeficitMm,
  simulateZone,
  stateBefore,
  wateringLitres,
  wateringMinutes,
} from "../src/water.js";
import type { DailyWeather } from "../src/weather.js";

const [toms, herbs] = defaultConfig().zones;

function approx(actual: number, expected: number, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${expected} ± ${eps}, got ${actual}`,
  );
}

function days(...specs: Array<[string, number, number]>): DailyWeather[] {
  return specs.map(([date, et0Mm, rainMm]) => ({ date, et0Mm, rainMm }));
}

test("pawMm multiplies AWC by root depth", () => {
  approx(pawMm(toms), 48); // loam 160 mm/m × 0.3 m
  approx(pawMm(herbs), 20); // sandy-loam 100 mm/m × 0.2 m
});

test("pawMm rejects unknown soils", () => {
  const bad: ZoneConfig = { id: "bad", name: "Bad", soil: "moon-dust", rootDepthM: 0.3 };
  assert.throws(() => pawMm(bad), /unknown soil/);
});

test("madMm applies maxDepletion", () => {
  approx(madMm(toms), 19.2); // 0.4 × 48
  approx(madMm(herbs), 10); // 0.5 × 20
});

test("etcMm applies kc and the mulch factor", () => {
  approx(etcMm(toms, 4), 2.94); // 4 × 1.05 × 0.7
  approx(etcMm(herbs, 4), 3.6); // 4 × 0.9
});

test("effectiveRainMm keeps 80%", () => {
  approx(effectiveRainMm(5), 4);
  assert.equal(effectiveRainMm(0), 0);
});

test("seedDeficitMm maps a soil moisture reading", () => {
  approx(seedDeficitMm(herbs, 0.13), 10); // half of the 0.08-0.18 span
  approx(seedDeficitMm(herbs, 0.05), 20); // below wilting point
  approx(seedDeficitMm(herbs, 0.2), 0); // above field capacity
  approx(seedDeficitMm(toms, 0.22), 24); // half of the 0.14-0.30 span
});

test("seedDeficitMm falls back to zero without a reading", () => {
  assert.equal(seedDeficitMm(herbs, null), 0);
  assert.equal(seedDeficitMm(herbs, undefined), 0);
});

test("wateringMinutes rounds up", () => {
  assert.equal(wateringMinutes(toms, 12), 67); // 12 / 0.9 / 12 h
  assert.equal(wateringMinutes(herbs, 10), 89); // 10 / 0.85 / 8 h
});

test("wateringLitres uses the bed area", () => {
  approx(wateringLitres(toms, 12) ?? -1, 54);
  const noArea: ZoneConfig = { id: "pot", name: "Pot", soil: "loam", rootDepthM: 0.2 };
  assert.equal(wateringLitres(noArea, 12), null);
});

test("appliedMmFromMinutes inverts the minutes math", () => {
  approx(appliedMmFromMinutes(toms, 60), 10.8);
  approx(appliedMmFromMinutes(herbs, 30), 3.4);
});

test("simulateZone runs a dry spell with one rain and one watering", () => {
  const rows = simulateZone(
    herbs,
    days(
      ["2026-10-17", 4, 0],
      ["2026-10-18", 5, 0],
      ["2026-10-19", 5, 10],
      ["2026-10-20", 3, 0],
    ),
    { "2026-10-20": 5, "2099-01-01": 99 },
    0,
  );
  assert.equal(rows.length, 4);
  approx(rows[0].deficitMm, 3.6);
  approx(rows[1].deficitMm, 8.1);
  approx(rows[2].deficitMm, 4.6);
  approx(rows[3].deficitMm, 2.3);
  assert.equal(rows[0].wateringMm, 0);
  approx(rows[3].wateringMm, 5);
  approx(rows[3].depletion, 0.115); // 2.3 / 20
});

test("simulateZone clamps at both ends", () => {
  const rows = simulateZone(
    herbs,
    days(["2026-10-17", 1, 0], ["2026-10-18", 2, 0], ["2026-10-19", 0, 100]),
    {},
    19,
  );
  approx(rows[0].deficitMm, 19.9);
  approx(rows[1].deficitMm, 20); // clamped at PAW
  assert.equal(rows[2].deficitMm, 0); // downpour clamps at zero
});

test("simulateZone clamps the seed value", () => {
  const rows = simulateZone(herbs, days(["2026-10-17", 0, 0]), {}, 999);
  approx(rows[0].deficitMm, 20);
});

test("stateBefore returns the end of the previous day", () => {
  const rows = simulateZone(
    herbs,
    days(["2026-10-17", 4, 0], ["2026-10-18", 5, 0], ["2026-10-19", 5, 10]),
    {},
    0,
  );
  const state = stateBefore(herbs, rows, "2026-10-19");
  assert.equal(state?.date, "2026-10-18");
  approx(state?.deficitMm ?? -1, 8.1);
  approx(state?.depletion ?? -1, 8.1 / 20);
  assert.equal(stateBefore(herbs, rows, "2026-10-17"), null);
  assert.equal(stateBefore(herbs, rows, "2099-01-01")?.date, "2026-10-19");
});

test("effectiveRainSum sums the lookahead window", () => {
  const list = days(
    ["2026-10-17", 4, 0],
    ["2026-10-18", 5, 0],
    ["2026-10-19", 5, 10],
    ["2026-10-20", 3, 5],
  );
  approx(effectiveRainSum(list, "2026-10-18", 2), 8); // 10 mm on the 19th
  approx(effectiveRainSum(list, "2026-10-18", 3), 12); // plus 5 mm on the 20th
  assert.equal(effectiveRainSum(list, "2026-10-18", 0), 0);
  assert.equal(effectiveRainSum(list, "2100-01-01", 2), 0);
});