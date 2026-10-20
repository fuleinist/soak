import assert from "node:assert/strict";
import { test } from "node:test";

import type { ZoneAdvice, ZonePlan } from "../src/advisor.js";
import {
  formatPlanText,
  formatStatusText,
  planJson,
  statusJson,
  type StatusMeta,
} from "../src/report.js";

const meta: StatusMeta = {
  today: "2026-10-21",
  gardenName: "Backyard beds",
  fetchedAt: "2026-10-20T19:00:00.000Z",
  ageHours: 0.1,
  dataRange: { start: "2026-10-07", end: "2026-10-27" },
  modelNote: "deficit calibrated to the soil moisture reading (0.19 m³/m³)",
  missingValues: 0,
};

function advice(overrides: Partial<ZoneAdvice>): ZoneAdvice {
  return {
    zoneId: "toms",
    zoneName: "Tomato bed",
    verdict: "ok",
    stateDate: "2026-10-20",
    deficitMm: 0,
    depletion: 0,
    depletionPct: 0,
    pawMm: 48,
    madMm: 19.2,
    rainSumMm: 0,
    lookaheadDays: 2,
    reason: "no action needed",
    ...overrides,
  };
}

test("status text shows labels, amounts, and meta", () => {
  const text = formatStatusText(
    [
      advice({
        verdict: "water",
        needMm: 12.1,
        minutes: 67,
        litres: 54,
        reason: "soil is 45% depleted and rain will not cover it",
      }),
      advice({
        zoneId: "herbs",
        zoneName: "Herb pots",
        verdict: "ok",
        reason: "no action needed",
      }),
    ],
    meta,
  );
  assert.ok(text.includes("Backyard beds — garden status — 2026-10-21"));
  assert.ok(text.includes("WATER NOW: 12.1 mm (54 L) in about 67 min"));
  assert.ok(text.includes("soil is 45% depleted and rain will not cover it"));
  assert.ok(text.includes("OK"));
  assert.ok(text.includes("Weather data: 2026-10-07 .. 2026-10-27 (0.1 h old)"));
  assert.ok(text.includes("Model: deficit calibrated to the soil moisture reading (0.19 m³/m³)"));
  assert.ok(text.includes("water in the early morning"));
});

test("status text flags missing values", () => {
  const text = formatStatusText([advice({})], { ...meta, missingValues: 3 });
  assert.ok(text.includes("3 missing value(s)"));
});

test("status json carries the key data", () => {
  const json = statusJson(
    [advice({ verdict: "wait", reason: "rain covers the deficit (8.4 mm expected)" })],
    meta,
  );
  assert.equal(json.generatedFor, "2026-10-21");
  assert.equal(json.garden, "Backyard beds");
  const weather = json.weather as Record<string, unknown>;
  assert.equal(weather.ageHours, 0.1);
  const zones = json.zones as unknown[];
  assert.equal(zones.length, 1);
});

test("plan text lists only actionable days", () => {
  const plan: ZonePlan = {
    zoneId: "toms",
    zoneName: "Tomato bed",
    entries: [
      {
        date: "2026-10-21",
        deficitMm: 20,
        rainSumMm: 0,
        verdict: "water",
        needMm: 20,
        minutes: 111,
        litres: 90,
        reason: "soil is 42% depleted and rain will not cover it",
      },
      { date: "2026-10-22", deficitMm: 12, rainSumMm: 12, verdict: "ok", reason: "no action needed" },
      {
        date: "2026-10-23",
        deficitMm: 14,
        rainSumMm: 16,
        verdict: "wait",
        reason: "rain covers the deficit (16 mm expected)",
      },
    ],
  };
  const text = formatPlanText([plan], { today: "2026-10-21", days: 7, gardenName: "Backyard beds" });
  assert.ok(text.includes("next 7 days (2026-10-21)"));
  assert.ok(text.includes("2026-10-21  WATER NOW: 20 mm (90 L) in about 111 min"));
  assert.ok(text.includes("2026-10-23  WAIT FOR RAIN"));
  assert.ok(!text.includes("2026-10-22"));
});

test("plan text handles a quiet week", () => {
  const plan: ZonePlan = {
    zoneId: "herbs",
    zoneName: "Herb pots",
    entries: [
      { date: "2026-10-21", deficitMm: 2, rainSumMm: 0, verdict: "ok", reason: "no action needed" },
    ],
  };
  const text = formatPlanText([plan], { today: "2026-10-21", days: 7 });
  assert.ok(text.includes("No action needed this week."));
});

test("plan json carries the entries", () => {
  const plan: ZonePlan = { zoneId: "herbs", zoneName: "Herb pots", entries: [] };
  const json = planJson([plan], { today: "2026-10-21", days: 7 });
  assert.equal(json.days, 7);
  assert.equal((json.zones as unknown[]).length, 1);
});