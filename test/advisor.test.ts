import assert from "node:assert/strict";
import { test } from "node:test";

import { adviseZone, decideAction, MIN_USEFUL_MM, planZone } from "../src/advisor.js";
import { defaultConfig } from "../src/config.js";
import { simulateZone } from "../src/water.js";
import type { DailyWeather } from "../src/weather.js";

const [, herbs] = defaultConfig().zones;

function days(...specs: Array<[string, number, number]>): DailyWeather[] {
  return specs.map(([date, et0Mm, rainMm]) => ({ date, et0Mm, rainMm }));
}

function approx(actual: number, expected: number, eps = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected} ± ${eps}, got ${actual}`);
}

const TODAY = "2026-10-21";

test("decideAction boundaries", () => {
  assert.equal(MIN_USEFUL_MM, 2);
  assert.equal(decideAction(herbs, 7.9, 0).verdict, "ok");
  assert.equal(decideAction(herbs, 8, 0).verdict, "soon"); // 0.8 × MAD
  assert.equal(decideAction(herbs, 10, 10).verdict, "wait"); // rain covers exactly
  assert.equal(decideAction(herbs, 10, 8.5).verdict, "wait"); // 1.5 mm left
  const borderline = decideAction(herbs, 10, 8);
  assert.equal(borderline.verdict, "water"); // exactly 2 mm left
  approx(borderline.needMm ?? -1, 2);
  const water = decideAction(herbs, 12, 4);
  assert.equal(water.verdict, "water");
  approx(water.needMm ?? -1, 8);
  assert.ok(water.reason.includes("depleted"));
});

test("adviseZone says ok when the soil is wet", () => {
  const list = days(["2026-10-20", 4, 0]);
  const rows = simulateZone(herbs, list, {}, 0);
  const advice = adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(advice.verdict, "ok");
  assert.equal(advice.depletionPct, 18);
  assert.equal(advice.stateDate, "2026-10-20");
  approx(advice.deficitMm, 3.6);
});

test("adviseZone warns soon near MAD", () => {
  const list = days(["2026-10-20", 9.5, 0]);
  const rows = simulateZone(herbs, list, {}, 0);
  const advice = adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(advice.verdict, "soon");
});

test("adviseZone recommends water with minutes and litres", () => {
  const list = days(["2026-10-20", 12, 0]);
  const rows = simulateZone(herbs, list, {}, 0);
  const advice = adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(advice.verdict, "water");
  approx(advice.needMm ?? -1, 10.8);
  assert.equal(advice.minutes, 96);
  approx(advice.litres ?? -1, 12.96);
  assert.equal(advice.depletionPct, 54);
  assert.ok(advice.reason.includes("rain will not cover"));
});

test("adviseZone waits when rain covers the deficit", () => {
  const list = days(["2026-10-20", 12, 0], ["2026-10-21", 2, 20]);
  const rows = simulateZone(herbs, list, {}, 0);
  const advice = adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(advice.verdict, "wait");
  approx(advice.rainSumMm, 16);
  assert.ok(advice.reason.includes("rain covers"));
});

test("adviseZone waits when rain nearly covers the deficit", () => {
  const list = days(["2026-10-20", 12, 0], ["2026-10-21", 2, 12.5]);
  const rows = simulateZone(herbs, list, {}, 0);
  const advice = adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(advice.verdict, "wait");
  assert.ok(advice.reason.includes("nearly"));
});

test("adviseZone waters the shortfall when rain is partial", () => {
  const list = days(["2026-10-20", 12, 0], ["2026-10-21", 2, 6]);
  const rows = simulateZone(herbs, list, {}, 0);
  const advice = adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(advice.verdict, "water");
  approx(advice.needMm ?? -1, 6); // 10.8 − 4.8
  assert.equal(advice.minutes, 53);
});

test("adviseZone ignores rain beyond the lookahead", () => {
  const list = days(["2026-10-20", 12, 0], ["2026-10-23", 2, 100]);
  const rows = simulateZone(herbs, list, {}, 0);
  const advice = adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(advice.verdict, "water"); // rain on the 23rd is too far away
  assert.equal(advice.rainSumMm, 0);
});

test("adviseZone fails when the window does not cover today", () => {
  const list = days(["2026-10-21", 4, 0]);
  const rows = simulateZone(herbs, list, {}, 0);
  assert.throws(
    () => adviseZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 }),
    /does not cover/,
  );
});

test("planZone builds a day-by-day plan", () => {
  const list = days(
    ["2026-10-20", 12, 0],
    ["2026-10-21", 2, 0],
    ["2026-10-22", 2, 0],
    ["2026-10-23", 2, 20],
    ["2026-10-24", 2, 0],
  );
  const rows = simulateZone(herbs, list, {}, 0);
  const plan = planZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.equal(plan.zoneId, "herbs");
  assert.deepEqual(
    plan.entries.map((entry) => entry.verdict),
    ["water", "ok", "ok", "ok"],
  );
  approx(plan.entries[0].needMm ?? -1, 10.8);
  assert.equal(plan.entries[0].date, "2026-10-21");
  assert.equal(plan.entries[3].date, "2026-10-24");
});

test("planZone skips when rain covers the deficit", () => {
  const list = days(
    ["2026-10-20", 12, 0],
    ["2026-10-21", 2, 0],
    ["2026-10-22", 2, 30],
    ["2026-10-23", 2, 0],
  );
  const rows = simulateZone(herbs, list, {}, 0);
  const plan = planZone(herbs, rows, list, { today: TODAY, rainLookaheadDays: 2 });
  assert.deepEqual(
    plan.entries.map((entry) => entry.verdict),
    ["wait", "wait", "ok"],
  );
});

test("planZone skips days without a prior state", () => {
  const list = days(["2026-10-20", 4, 0], ["2026-10-21", 4, 0]);
  const rows = simulateZone(herbs, list, {}, 0);
  const plan = planZone(herbs, rows, list, { today: "2026-10-20", rainLookaheadDays: 2 });
  assert.deepEqual(plan.entries, []);
});