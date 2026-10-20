#!/usr/bin/env node
/**
 * soak — command line interface.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  collectConfigIssues,
  collectConfigWarnings,
  ConfigError,
  DEFAULT_CACHE_HOURS,
  DEFAULT_RAIN_LOOKAHEAD_DAYS,
  defaultConfig,
  loadConfigFile,
  type SoakConfig,
} from "./config.js";
import { DEMO_TODAY, demoConfig, demoWeather } from "./demo.js";
import { balanceCsv, htmlReport, type ZoneBalance } from "./export.js";
import { buildAlert, sendNtfy } from "./notify.js";
import { planGarden, runGarden, type GardenRun } from "./pipeline.js";
import {
  formatPlanText,
  formatStatusText,
  planJson,
  statusJson,
  type StatusMeta,
} from "./report.js";
import { addDays, isoNow, localDateISO, round1 } from "./util.js";
import {
  ageInHours,
  fetchWeather,
  loadWeatherCache,
  saveWeatherCache,
  weatherRange,
  type WeatherCache,
} from "./weather.js";
import { addWatering, loadWaterings, validateWateringInput } from "./waterings.js";

const VERSION = "0.1.0";
const DEFAULT_CONFIG_PATH = "soak.json";

export class CliUsageError extends Error {}

export interface CliOptions {
  command: string;
  configPath: string;
  json: boolean;
  offline: boolean;
  force: boolean;
  now?: string;
  zone?: string;
  date?: string;
  mm?: number;
  minutes?: number;
  note?: string;
  list: boolean;
  days?: number;
  format?: string;
  out?: string;
  dryRun: boolean;
  help: boolean;
  version: boolean;
}

const USAGE = `soak — garden watering advisor

Usage: soak <command> [options]

Commands:
  init                 write a template soak.json
  validate             check soak.json for problems
  fetch                download weather + soil moisture into the cache
  status               show the current advice per zone
  plan                 show the watering plan for the next 7 days
  log                  record a watering, or list the log
  export               write the water balance as CSV or HTML
  notify               send ntfy alerts for zones that need water
  demo                 run offline with bundled sample data

Options:
  --config <file>      config file (default: soak.json)
  --json               print output as JSON
  --offline            never call the network (fetch rejects it)
  --force              overwrite files where allowed
  --now <timestamp>    override the current time (ISO 8601)
  --zone <id>          zone id (log)
  --date <YYYY-MM-DD>  watering date (log; default: today)
  --mm <n>             watering amount in millimetres (log)
  --minutes <n>        watering length in minutes (log)
  --note <text>        free-text note (log)
  --list               list recent waterings (log)
  --days <n>           plan length in days (plan; default 7)
  --format <name>      export format: csv | html (default csv)
  --out <file>         write output to a file (export)
  --dry-run            print alerts instead of sending them (notify)
  -h, --help           show this help
  -v, --version        show the version`;

function needValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new CliUsageError(`option ${flag} needs a value`);
  }
  return value;
}

function needNumber(argv: string[], index: number, flag: string): number {
  const raw = needValue(argv, index, flag);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new CliUsageError(`option ${flag} needs a number, got: ${raw}`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "",
    configPath: DEFAULT_CONFIG_PATH,
    json: false,
    offline: false,
    force: false,
    list: false,
    dryRun: false,
    help: false,
    version: false,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--config":
        options.configPath = needValue(argv, ++i, arg);
        break;
      case "--json":
        options.json = true;
        break;
      case "--offline":
        options.offline = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--now":
        options.now = needValue(argv, ++i, arg);
        break;
      case "--zone":
        options.zone = needValue(argv, ++i, arg);
        break;
      case "--date":
        options.date = needValue(argv, ++i, arg);
        break;
      case "--mm":
        options.mm = needNumber(argv, ++i, arg);
        break;
      case "--minutes":
        options.minutes = needNumber(argv, ++i, arg);
        break;
      case "--note":
        options.note = needValue(argv, ++i, arg);
        break;
      case "--list":
        options.list = true;
        break;
      case "--days":
        options.days = needNumber(argv, ++i, arg);
        break;
      case "--format":
        options.format = needValue(argv, ++i, arg);
        break;
      case "--out":
        options.out = needValue(argv, ++i, arg);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--version":
        options.version = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new CliUsageError(`unknown option: ${arg}`);
        }
        if (options.command !== "") {
          throw new CliUsageError(`unexpected argument: ${arg}`);
        }
        options.command = arg;
        break;
    }
    i += 1;
  }
  return options;
}

function parseNow(value: string | undefined): Date {
  if (value === undefined) {
    return new Date();
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    throw new CliUsageError(`--now is not a valid timestamp: ${value}`);
  }
  return new Date(t);
}

function requireValidConfig(options: CliOptions): SoakConfig {
  const config = loadConfigFile(options.configPath);
  const issues = collectConfigIssues(config);
  if (issues.length > 0) {
    throw new ConfigError(`config problems:\n- ${issues.join("\n- ")}`);
  }
  return config;
}

interface RunContext {
  config: SoakConfig;
  cache: WeatherCache;
  today: string;
  garden: GardenRun;
  adviceOptions: { today: string; rainLookaheadDays: number };
}

function loadRunContext(options: CliOptions, now: Date): RunContext {
  const config = requireValidConfig(options);
  const cache = loadWeatherCache(config.dataDir);
  if (cache === null) {
    throw new Error("no weather cache found. Run: soak fetch");
  }
  const today = localDateISO(now, cache.timezone);
  const events = loadWaterings(config.dataDir);
  const adviceOptions = {
    today,
    rainLookaheadDays: config.weather?.rainLookaheadDays ?? DEFAULT_RAIN_LOOKAHEAD_DAYS,
  };
  const garden = runGarden(config, cache, events, adviceOptions);
  return { config, cache, today, garden, adviceOptions };
}

function cmdInit(options: CliOptions): number {
  if (existsSync(options.configPath) && !options.force) {
    throw new Error(`${options.configPath} already exists. Use --force to overwrite.`);
  }
  writeFileSync(options.configPath, `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  console.log(`Wrote ${options.configPath}.`);
  return 0;
}

function cmdValidate(options: CliOptions): number {
  const config = loadConfigFile(options.configPath);
  const issues = collectConfigIssues(config);
  const warnings = collectConfigWarnings(config);
  if (options.json) {
    console.log(JSON.stringify({ issues, warnings }, null, 2));
    return issues.length > 0 ? 1 : 0;
  }
  for (const issue of issues) {
    console.log(`error: ${issue}`);
  }
  for (const warning of warnings) {
    console.log(`warning: ${warning}`);
  }
  if (issues.length === 0 && warnings.length === 0) {
    console.log(`${options.configPath} looks good.`);
  } else if (issues.length === 0) {
    console.log("No errors found.");
  } else {
    console.log(`${issues.length} error(s) found.`);
  }
  return issues.length > 0 ? 1 : 0;
}

async function cmdFetch(options: CliOptions, now: Date): Promise<number> {
  if (options.offline) {
    throw new Error("fetch needs the network. Remove --offline.");
  }
  const config = requireValidConfig(options);
  const cache = await fetchWeather(config.garden.latitude, config.garden.longitude, { now });
  const path = saveWeatherCache(cache, config.dataDir);
  const range = weatherRange(cache);
  if (options.json) {
    console.log(JSON.stringify(cache, null, 2));
    return 0;
  }
  console.log(`Saved ${path}.`);
  console.log(`Days: ${cache.daily.time.length} (${range?.start} .. ${range?.end}).`);
  if (cache.soilMoisture) {
    console.log(`Soil moisture: ${cache.soilMoisture.value} m³/m³ at ${cache.soilMoisture.time}.`);
  } else {
    console.log("Soil moisture: not available.");
  }
  if (cache.missingValues > 0) {
    console.log(`Missing values: ${cache.missingValues}.`);
  }
  return 0;
}

function cmdStatus(options: CliOptions, now: Date): number {
  const { config, cache, today, garden } = loadRunContext(options, now);
  const advices = garden.runs.map((run) => run.advice);
  const meta: StatusMeta = {
    today,
    gardenName: config.garden.name,
    fetchedAt: cache.fetchedAt,
    ageHours: ageInHours(cache.fetchedAt, now),
    dataRange: weatherRange(cache),
    modelNote: garden.modelNote,
    missingValues: cache.missingValues,
  };
  if (options.json) {
    console.log(JSON.stringify(statusJson(advices, meta), null, 2));
    return 0;
  }
  console.log(formatStatusText(advices, meta));
  const cacheHours = config.weather?.cacheHours ?? DEFAULT_CACHE_HOURS;
  if (meta.ageHours > cacheHours) {
    console.log(`Note: the cache is ${round1(meta.ageHours)} h old. Consider: soak fetch`);
  }
  return 0;
}

function cmdPlan(options: CliOptions, now: Date): number {
  const { config, today, garden, adviceOptions } = loadRunContext(options, now);
  const days = options.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 16) {
    throw new CliUsageError("--days must be an integer between 1 and 16");
  }
  const forecast = garden.days.filter(
    (day) => day.date >= today && day.date < addDays(today, days),
  );
  const plans = planGarden(garden.runs, forecast, adviceOptions);
  const meta = { today, days, gardenName: config.garden.name };
  if (options.json) {
    console.log(JSON.stringify(planJson(plans, meta), null, 2));
    return 0;
  }
  console.log(formatPlanText(plans, meta));
  return 0;
}

function cmdLog(options: CliOptions, now: Date): number {
  const config = requireValidConfig(options);
  if (options.list) {
    const events = loadWaterings(config.dataDir)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const recent = events.slice(-20);
    if (options.json) {
      console.log(JSON.stringify(recent, null, 2));
      return 0;
    }
    if (recent.length === 0) {
      console.log("No waterings logged yet.");
      return 0;
    }
    for (const event of recent) {
      const bits = [event.date, event.zoneId, `${event.mm} mm`];
      if (event.minutes !== undefined) {
        bits.push(`${event.minutes} min`);
      }
      if (event.note) {
        bits.push(event.note);
      }
      console.log(bits.join("  "));
    }
    return 0;
  }
  const zone = options.zone;
  if (zone === undefined) {
    throw new CliUsageError("log needs --zone (or use --list)");
  }
  const cache = loadWeatherCache(config.dataDir);
  const date = options.date ?? localDateISO(now, cache?.timezone);
  const input = {
    zoneId: zone,
    date,
    mm: options.mm,
    minutes: options.minutes,
    note: options.note,
  };
  const issues = validateWateringInput(input, config);
  if (issues.length > 0) {
    throw new CliUsageError(issues.join(". "));
  }
  const event = addWatering(config, input, now);
  console.log(`Logged ${event.mm} mm for ${event.zoneId} on ${event.date} (${event.id}).`);
  return 0;
}

function cmdExport(options: CliOptions, now: Date): number {
  const { config, garden } = loadRunContext(options, now);
  const format = options.format ?? "csv";
  if (format !== "csv" && format !== "html") {
    throw new CliUsageError(`--format must be csv or html, got: ${format}`);
  }
  const balances: ZoneBalance[] = garden.runs.map((run) => ({
    zoneId: run.zone.id,
    zoneName: run.zone.name,
    rows: run.rows,
  }));
  const content =
    format === "csv"
      ? balanceCsv(balances)
      : htmlReport({
          gardenName: config.garden.name,
          generatedAt: isoNow(now),
          modelNote: garden.modelNote,
          advices: garden.runs.map((run) => run.advice),
          balances,
        });
  if (options.out) {
    const dir = dirname(options.out);
    if (dir !== ".") {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(options.out, content);
    console.log(`Wrote ${options.out} (${format}).`);
  } else {
    process.stdout.write(content);
  }
  return 0;
}

async function cmdNotify(options: CliOptions, now: Date): Promise<number> {
  const { config, garden } = loadRunContext(options, now);
  const advices = garden.runs.map((run) => run.advice);
  const alert = buildAlert(advices);
  if (alert === null) {
    console.log("No zone needs water. No alert sent.");
    return 0;
  }
  if (options.dryRun) {
    console.log(alert);
    return 0;
  }
  const server = config.notify?.server ?? "https://ntfy.sh";
  const topic = config.notify?.topic ?? "";
  if (topic === "") {
    throw new ConfigError("notify.topic is empty; set it in the config first");
  }
  await sendNtfy(server, topic, alert);
  console.log(`Sent alert to ${server}/${topic}.`);
  return 0;
}

function cmdDemo(options: CliOptions): number {
  const config = demoConfig();
  const cache = demoWeather();
  const adviceOptions = { today: DEMO_TODAY, rainLookaheadDays: DEFAULT_RAIN_LOOKAHEAD_DAYS };
  const garden = runGarden(config, cache, [], adviceOptions);
  const advices = garden.runs.map((run) => run.advice);
  const forecast = garden.days.filter((day) => day.date >= DEMO_TODAY);
  const plans = planGarden(garden.runs, forecast, adviceOptions);
  const meta: StatusMeta = {
    today: DEMO_TODAY,
    gardenName: config.garden.name,
    fetchedAt: cache.fetchedAt,
    ageHours: 0,
    dataRange: weatherRange(cache),
    modelNote: garden.modelNote,
    missingValues: 0,
  };
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          status: statusJson(advices, meta),
          plan: planJson(plans, { today: DEMO_TODAY, days: 7, gardenName: config.garden.name }),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log("soak demo — offline sample garden (no network)");
  console.log("");
  console.log(formatStatusText(advices, meta));
  console.log("");
  console.log(
    formatPlanText(plans, { today: DEMO_TODAY, days: 7, gardenName: config.garden.name }),
  );
  console.log("");
  console.log("Demo data is bundled. No network was used.");
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(`soak: ${err.message}`);
      console.error("Run soak --help for usage.");
      return 2;
    }
    throw err;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.version) {
    console.log(VERSION);
    return 0;
  }
  if (options.command === "") {
    console.log(USAGE);
    return 2;
  }
  try {
    const now = parseNow(options.now);
    switch (options.command) {
      case "init":
        return cmdInit(options);
      case "validate":
        return cmdValidate(options);
      case "fetch":
        return await cmdFetch(options, now);
      case "status":
        return cmdStatus(options, now);
      case "plan":
        return cmdPlan(options, now);
      case "log":
        return cmdLog(options, now);
      case "export":
        return cmdExport(options, now);
      case "notify":
        return await cmdNotify(options, now);
      case "demo":
        return cmdDemo(options);
      default:
        throw new CliUsageError(`unknown command: ${options.command}`);
    }
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(`soak: ${err.message}`);
      return 2;
    }
    if (err instanceof ConfigError) {
      console.error(`soak: ${err.message}`);
      return 3;
    }
    console.error(`soak: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`soak: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });