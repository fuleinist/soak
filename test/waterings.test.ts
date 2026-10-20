import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defaultConfig, type SoakConfig } from "../src/config.js";
import {
  addWatering,
  loadWaterings,
  validateWateringInput,
  wateringsByDate,
  wateringsPath,
} from "../src/waterings.js";

function scratchConfig(): SoakConfig {
  const config = defaultConfig();
  config.dataDir = mkdtempSync(join(tmpdir(), "soak-log-"));
  return config;
}

test("validateWateringInput collects problems", () => {
  const config = scratchConfig();
  const issues = validateWateringInput({ zoneId: "nope", date: "10-10-2026" }, config);
  assert.ok(issues.includes("unknown zone: nope"));
  assert.ok(issues.includes("date must be YYYY-MM-DD, got: 10-10-2026"));
  assert.ok(issues.includes("give an amount: --mm or --minutes"));
  const both = validateWateringInput(
    { zoneId: "toms", date: "2026-10-21", mm: 5, minutes: 10 },
    config,
  );
  assert.ok(both.includes("give either --mm or --minutes, not both"));
  const negative = validateWateringInput({ zoneId: "toms", date: "2026-10-21", mm: -1 }, config);
  assert.ok(negative.includes("mm must be a positive number"));
  const zeroMinutes = validateWateringInput(
    { zoneId: "toms", date: "2026-10-21", minutes: 0 },
    config,
  );
  assert.ok(zeroMinutes.includes("minutes must be a positive number"));
});

test("addWatering appends a mm event", () => {
  const config = scratchConfig();
  const event = addWatering(
    config,
    { zoneId: "toms", date: "2026-10-21", mm: 12.3 },
    new Date("2026-10-21T06:00:00+11:00"),
  );
  assert.equal(event.id, "w-toms-20261021-1");
  assert.equal(event.mm, 12.3);
  assert.equal(event.createdAt, "2026-10-20T19:00:00.000Z");
  const raw = readFileSync(wateringsPath(config.dataDir), "utf8").trim();
  assert.equal(raw.split("\n").length, 1);
  assert.equal((JSON.parse(raw) as { id: string }).id, "w-toms-20261021-1");
});

test("addWatering rounds to two decimals", () => {
  const config = scratchConfig();
  const event = addWatering(config, { zoneId: "toms", date: "2026-10-21", mm: 10.083 });
  assert.equal(event.mm, 10.08);
});

test("addWatering numbers repeated events on the same date", () => {
  const config = scratchConfig();
  addWatering(config, { zoneId: "toms", date: "2026-10-21", mm: 6 });
  const second = addWatering(config, { zoneId: "toms", date: "2026-10-21", mm: 4 });
  assert.equal(second.id, "w-toms-20261021-2");
  const events = loadWaterings(config.dataDir);
  assert.equal(events.length, 2);
  assert.equal(wateringsByDate(events, "toms")["2026-10-21"], 10);
});

test("addWatering converts minutes using the zone system", () => {
  const config = scratchConfig();
  const event = addWatering(config, { zoneId: "toms", date: "2026-10-21", minutes: 60 });
  assert.equal(event.mm, 10.8); // 60 min × 12 mm/h × 0.9
  assert.equal(event.minutes, 60);
});

test("addWatering keeps a note", () => {
  const config = scratchConfig();
  addWatering(config, { zoneId: "herbs", date: "2026-10-20", mm: 3, note: "evening top-up" });
  const events = loadWaterings(config.dataDir);
  assert.equal(events[0].note, "evening top-up");
});

test("addWatering rejects bad input", () => {
  const config = scratchConfig();
  assert.throws(
    () => addWatering(config, { zoneId: "nope", date: "2026-10-21", mm: 1 }),
    /unknown zone/,
  );
  assert.throws(() => addWatering(config, { zoneId: "toms", date: "2026-10-21" }), /give an amount/);
});

test("loadWaterings skips malformed lines", () => {
  const config = scratchConfig();
  addWatering(config, { zoneId: "toms", date: "2026-10-21", mm: 5 });
  appendFileSync(wateringsPath(config.dataDir), "{ not json\n{\"id\":\"x\"}\n");
  const events = loadWaterings(config.dataDir);
  assert.equal(events.length, 1);
});

test("loadWaterings returns empty for a fresh dir", () => {
  const config = scratchConfig();
  assert.deepEqual(loadWaterings(config.dataDir), []);
});

test("wateringsByDate filters by zone", () => {
  const config = scratchConfig();
  addWatering(config, { zoneId: "toms", date: "2026-10-21", mm: 6 });
  addWatering(config, { zoneId: "herbs", date: "2026-10-21", mm: 2 });
  addWatering(config, { zoneId: "toms", date: "2026-10-22", mm: 4 });
  const events = loadWaterings(config.dataDir);
  const toms = wateringsByDate(events, "toms");
  assert.deepEqual(toms, { "2026-10-21": 6, "2026-10-22": 4 });
  assert.deepEqual(wateringsByDate(events, "herbs"), { "2026-10-21": 2 });
});