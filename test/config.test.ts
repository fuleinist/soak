import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  collectConfigIssues,
  collectConfigWarnings,
  ConfigError,
  defaultConfig,
  effectiveKc,
  effectiveMaxDepletion,
  effectiveWatering,
  isMulched,
  loadConfigFile,
  type SoakConfig,
} from "../src/config.js";

function clone(config: SoakConfig): SoakConfig {
  return JSON.parse(JSON.stringify(config)) as SoakConfig;
}

function scratchFile(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "soak-config-"));
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

test("defaultConfig is internally consistent", () => {
  const config = defaultConfig();
  assert.deepEqual(collectConfigIssues(config), []);
  assert.equal(config.zones.length, 2);
  assert.equal(config.weather?.cacheHours, 6);
});

test("loadConfigFile reads a config object", () => {
  const path = scratchFile("soak.json", JSON.stringify(defaultConfig()));
  const config = loadConfigFile(path);
  assert.equal(config.version, 1);
  assert.equal(config.zones[0].id, "toms");
});

test("loadConfigFile rejects missing files", () => {
  assert.throws(() => loadConfigFile("definitely-not-here.json"), ConfigError);
});

test("loadConfigFile rejects broken JSON", () => {
  const path = scratchFile("soak.json", "{ not json");
  assert.throws(() => loadConfigFile(path), /not valid JSON/);
});

test("loadConfigFile rejects arrays", () => {
  const path = scratchFile("soak.json", "[]");
  assert.throws(() => loadConfigFile(path), /JSON object/);
});

test("issues: version, dataDir, and garden", () => {
  const config = clone(defaultConfig());
  (config as { version: number }).version = 2;
  config.dataDir = "";
  config.garden.latitude = 123;
  config.garden.longitude = -200;
  const issues = collectConfigIssues(config);
  assert.ok(issues.includes("version must be 1"));
  assert.ok(issues.includes("dataDir must be a non-empty string"));
  assert.ok(issues.includes("garden.latitude must be a number between -90 and 90"));
  assert.ok(issues.includes("garden.longitude must be a number between -180 and 180"));
});

test("issues: zones array and zone fields", () => {
  const config = clone(defaultConfig());
  config.zones[1].id = "";
  config.zones[1].soil = "moon-dust";
  config.zones[1].rootDepthM = 0;
  config.zones.push({ id: "toms", name: "Copy bed", soil: "loam", rootDepthM: 0.3 });
  const issues = collectConfigIssues(config);
  assert.ok(issues.includes("zones[1].id must be a non-empty string"));
  assert.ok(issues.some((i) => i.includes("duplicate")));
  assert.ok(issues.includes("zones[1].soil must be one of: sand, sandy-loam, loam, silt-loam, clay-loam, clay"));
  assert.ok(issues.includes("zones[1].rootDepthM must be a number between 0 and 5"));
});

test("issues: optional numeric zone fields", () => {
  const config = clone(defaultConfig());
  config.zones[0].kc = -1;
  config.zones[0].maxDepletion = 0.9;
  config.zones[1].areaM2 = 0;
  config.zones[1].watering = { precipRateMmPerHour: 0, efficiency: 1.5 };
  const issues = collectConfigIssues(config);
  assert.ok(issues.includes("zones[0].kc must be a positive number"));
  assert.ok(issues.includes("zones[0].maxDepletion must be a number between 0.2 and 0.8"));
  assert.ok(issues.includes("zones[1].areaM2 must be a positive number"));
  assert.ok(issues.includes("zones[1].watering.precipRateMmPerHour must be a positive number"));
  assert.ok(issues.includes("zones[1].watering.efficiency must be a number between 0 and 1"));
});

test("issues: weather and notify blocks", () => {
  const config = clone(defaultConfig());
  config.weather = { cacheHours: 0, rainLookaheadDays: 9 };
  config.notify = { server: 42 as unknown as string };
  const issues = collectConfigIssues(config);
  assert.ok(issues.includes("weather.cacheHours must be a positive number"));
  assert.ok(issues.includes("weather.rainLookaheadDays must be an integer between 0 and 5"));
  assert.ok(issues.includes("notify.server must be a string"));
});

test("issues: empty zones array", () => {
  const config = clone(defaultConfig());
  config.zones = [];
  assert.ok(collectConfigIssues(config).includes("zones must be a non-empty array"));
});

test("warnings: id style and empty topic", () => {
  const config = clone(defaultConfig());
  config.zones[0].id = "TOMS";
  config.zones[1].id = " herbs ";
  const warnings = collectConfigWarnings(config);
  assert.ok(warnings.some((w) => w.includes('"TOMS" is not lowercase')));
  assert.ok(warnings.some((w) => w.includes("leading or trailing spaces")));
  assert.ok(warnings.includes("notify.topic is empty; the notify command cannot send messages"));
});

test("warnings: missing watering block", () => {
  const config = clone(defaultConfig());
  delete config.zones[0].watering;
  const warnings = collectConfigWarnings(config);
  assert.ok(warnings.some((w) => w.includes("watering is missing")));
});

test("accessors apply defaults", () => {
  const config = defaultConfig();
  const [toms, herbs] = config.zones;
  assert.equal(effectiveKc(toms), 1.05);
  assert.equal(effectiveMaxDepletion(toms), 0.4);
  assert.equal(isMulched(toms), true);
  assert.deepEqual(effectiveWatering(toms), { precipRateMmPerHour: 12, efficiency: 0.9 });
  assert.equal(effectiveKc(herbs), 0.9);
  assert.equal(effectiveMaxDepletion(herbs), 0.5);
  assert.equal(isMulched(herbs), false);
  assert.deepEqual(effectiveWatering(herbs), { precipRateMmPerHour: 8, efficiency: 0.85 });
});

test("accessors apply defaults when fields are absent", () => {
  const bare = clone(defaultConfig());
  bare.zones = [{ id: "bare", name: "Bare bed", soil: "loam", rootDepthM: 0.25 }];
  const zone = bare.zones[0];
  assert.equal(effectiveKc(zone), 1);
  assert.equal(effectiveMaxDepletion(zone), 0.5);
  assert.equal(isMulched(zone), false);
  assert.deepEqual(effectiveWatering(zone), { precipRateMmPerHour: 10, efficiency: 0.85 });
});