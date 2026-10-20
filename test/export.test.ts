import assert from "node:assert/strict";
import { test } from "node:test";

import type { ZoneAdvice } from "../src/advisor.js";
import { balanceCsv, htmlReport } from "../src/export.js";
import type { BalanceRow } from "../src/water.js";

function row(overrides: Partial<BalanceRow>): BalanceRow {
  return {
    date: "2026-10-21",
    et0Mm: 4,
    etcMm: 2.8,
    rainMm: 0,
    effRainMm: 0,
    wateringMm: 5,
    deficitMm: 12.34567,
    depletion: 0.2375,
    ...overrides,
  };
}

test("balanceCsv writes the documented header and rows", () => {
  const csv = balanceCsv([{ zoneId: "toms", zoneName: "Tomato bed", rows: [row({})] }]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "date,zone_id,et0_mm,etc_mm,rain_mm,watering_mm,deficit_mm,depletion_pct");
  assert.equal(lines[1], "2026-10-21,toms,4,2.8,0,5,12.35,24");
});

test("balanceCsv quotes awkward zone ids", () => {
  const csv = balanceCsv([{ zoneId: 'we"ird,id', zoneName: "x", rows: [row({})] }]);
  const line = csv.trim().split("\n")[1];
  assert.ok(line.includes('"we""ird,id"'));
});

test("htmlReport is self-contained and escapes text", () => {
  const advice: ZoneAdvice = {
    zoneId: "toms",
    zoneName: "<Tomato bed>",
    verdict: "water",
    needMm: 12.1,
    minutes: 67,
    litres: 54,
    reason: "soil is 45% depleted and rain will not cover it",
    stateDate: "2026-10-20",
    deficitMm: 12.1,
    depletion: 0.252,
    depletionPct: 25,
    pawMm: 48,
    madMm: 19.2,
    rainSumMm: 0,
    lookaheadDays: 2,
  };
  const html = htmlReport({
    gardenName: "Backyard beds",
    generatedAt: "2026-10-21T06:00:00.000Z",
    modelNote: "full profile assumed at the start of the history window",
    advices: [advice],
    balances: [{ zoneId: "toms", zoneName: "Tomato bed", rows: [row({})] }],
  });
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("&lt;Tomato bed&gt;"));
  assert.ok(!html.includes("<Tomato bed>"));
  assert.ok(html.includes("WATER NOW"));
  assert.ok(html.includes("12.1 mm (54 L) in about 67 min"));
  assert.ok(html.includes("width:24%"));
  assert.ok(html.includes("<table>"));
});