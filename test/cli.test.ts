import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultConfig, type SoakConfig } from "../src/config.js";
import { addDays } from "../src/util.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "soak-cli-"));
}

function writeConfig(dir: string, mutate?: (config: SoakConfig) => void): void {
  const config = defaultConfig();
  mutate?.(config);
  writeFileSync(join(dir, "soak.json"), JSON.stringify(config, null, 2));
}

function writeCache(dir: string): void {
  const time: string[] = [];
  const et0: number[] = [];
  const precipitation: number[] = [];
  for (let i = 0; i < 21; i += 1) {
    time.push(addDays("2026-10-07", i));
    et0.push(5);
    precipitation.push(0);
  }
  const cache = {
    fetchedAt: new Date().toISOString(),
    latitude: -33.7,
    longitude: 151.0,
    timezone: "Australia/Sydney",
    daily: { time, et0, precipitation },
    soilMoisture: null,
    missingValues: 0,
  };
  mkdirSync(join(dir, "data", "cache"), { recursive: true });
  writeFileSync(join(dir, "data", "cache", "weather.json"), JSON.stringify(cache));
}

const NOW = "2026-10-21T06:00:00+11:00";

test("help and version", () => {
  const dir = scratch();
  const help = runCli(["--help"], dir);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes("Usage: soak"));
  const version = runCli(["-v"], dir);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), "0.1.0");
});

test("no command prints usage and exits 2", () => {
  const res = runCli([], scratch());
  assert.equal(res.status, 2);
  assert.ok(res.stdout.includes("Usage: soak"));
});

test("unknown command exits 2", () => {
  const res = runCli(["frobnicate"], scratch());
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes("unknown command"));
});

test("init writes a valid template", () => {
  const dir = scratch();
  const init = runCli(["init"], dir);
  assert.equal(init.status, 0);
  assert.ok(init.stdout.includes("Wrote soak.json"));
  const validate = runCli(["validate"], dir);
  assert.equal(validate.status, 0);
  assert.ok(validate.stdout.includes("No errors found"));
});

test("init refuses to overwrite without force", () => {
  const dir = scratch();
  runCli(["init"], dir);
  const again = runCli(["init"], dir);
  assert.equal(again.status, 1);
  assert.ok(again.stderr.includes("already exists"));
  const forced = runCli(["init", "--force"], dir);
  assert.equal(forced.status, 0);
});

test("validate reports problems with exit 1", () => {
  const dir = scratch();
  writeConfig(dir, (config) => {
    (config as { version: number }).version = 2;
  });
  const res = runCli(["validate"], dir);
  assert.equal(res.status, 1);
  assert.ok(res.stdout.includes("error: version must be 1"));
});

test("validate --json emits an object", () => {
  const dir = scratch();
  runCli(["init"], dir);
  const res = runCli(["validate", "--json"], dir);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout) as { issues: string[] };
  assert.deepEqual(parsed.issues, []);
});

test("demo runs offline", () => {
  const res = runCli(["demo"], scratch());
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes("WATER NOW"));
  assert.ok(res.stdout.includes("Tomato bed"));
  assert.ok(res.stdout.includes("No network was used"));
});

test("demo --json emits parseable JSON", () => {
  const res = runCli(["demo", "--json"], scratch());
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout) as {
    status: { zones: Array<{ zoneId: string; verdict: string }> };
  };
  assert.equal(parsed.status.zones.length, 2);
  const toms = parsed.status.zones.find((zone) => zone.zoneId === "toms");
  assert.equal(toms?.verdict, "water");
});

test("status needs a cache", () => {
  const dir = scratch();
  runCli(["init"], dir);
  const res = runCli(["status"], dir);
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes("no weather cache"));
});

test("status gives advice from the cache", () => {
  const dir = scratch();
  writeConfig(dir);
  writeCache(dir);
  const res = runCli(["status", "--now", NOW], dir);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes("WATER NOW"));
  assert.ok(res.stdout.includes("herbs"));
  assert.ok(res.stdout.includes("full profile"));
});

test("plan lists the week", () => {
  const dir = scratch();
  writeConfig(dir);
  writeCache(dir);
  const res = runCli(["plan", "--now", NOW], dir);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes("watering plan"));
  assert.ok(res.stdout.includes("WATER NOW"));
});

test("log records and lists waterings", () => {
  const dir = scratch();
  runCli(["init"], dir);
  const add = runCli(["log", "--zone", "toms", "--date", "2026-10-21", "--mm", "5"], dir);
  assert.equal(add.status, 0);
  assert.ok(add.stdout.includes("Logged 5 mm"));
  const list = runCli(["log", "--list", "--json"], dir);
  assert.equal(list.status, 0);
  const events = JSON.parse(list.stdout) as Array<{ mm: number; zoneId: string }>;
  assert.equal(events.length, 1);
  assert.equal(events[0].mm, 5);
});

test("log rejects unknown zones as usage error", () => {
  const dir = scratch();
  runCli(["init"], dir);
  const res = runCli(["log", "--zone", "nope", "--mm", "5"], dir);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes("unknown zone"));
});

test("fetch rejects --offline", () => {
  const res = runCli(["fetch", "--offline"], scratch());
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes("needs the network"));
});

test("export writes CSV and HTML files", () => {
  const dir = scratch();
  writeConfig(dir);
  writeCache(dir);
  const csv = runCli(["export", "--out", "balance.csv", "--now", NOW], dir);
  assert.equal(csv.status, 0);
  const csvText = readFileSync(join(dir, "balance.csv"), "utf8");
  assert.ok(
    csvText.startsWith("date,zone_id,et0_mm,etc_mm,rain_mm,watering_mm,deficit_mm,depletion_pct"),
  );
  assert.ok(csvText.split("\n").length >= 43); // header + 2 zones × 21 rows
  const html = runCli(["export", "--format", "html", "--out", "report.html", "--now", NOW], dir);
  assert.equal(html.status, 0);
  const htmlText = readFileSync(join(dir, "report.html"), "utf8");
  assert.ok(htmlText.includes("<!DOCTYPE html>"));
  assert.ok(htmlText.includes("watering report"));
});

test("export rejects bad formats", () => {
  const dir = scratch();
  writeConfig(dir);
  writeCache(dir);
  const res = runCli(["export", "--format", "pdf"], dir);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes("--format must be csv or html"));
});

test("notify --dry-run prints the alert", () => {
  const dir = scratch();
  writeConfig(dir);
  writeCache(dir);
  const res = runCli(["notify", "--dry-run", "--now", NOW], dir);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes("2 zones need water today"));
});

test("notify needs a topic to send", () => {
  const dir = scratch();
  writeConfig(dir);
  writeCache(dir);
  const res = runCli(["notify", "--now", NOW], dir);
  assert.equal(res.status, 3);
  assert.ok(res.stderr.includes("topic"));
});