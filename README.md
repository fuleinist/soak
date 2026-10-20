# soak

A garden watering advisor.
It estimates the daily soil-water loss from free weather data.
Then it says when to water, how long to water, and when rain makes watering pointless.

No API keys. No runtime dependencies. Runs offline after one fetch, or with `demo`.

## What it does

- Reads free Open-Meteo data: daily reference evapotranspiration (ET0) and precipitation, plus a soil moisture reading.
- Tracks a root-zone water balance for each garden zone.
- Advises when to water (now, soon, or wait) and for how many minutes.
- Plans the next 7 days of watering.
- Records waterings in an append-only log. The model subtracts them.
- Exports the water balance as CSV or a small static HTML report.
- Sends reminders through ntfy.

## Requirements

- Node.js 20 or later.
- No API keys. The data service is free and open.

## Install and build

```sh
npm install
npm run build
npm test
```

Use the CLI from the repository:

```sh
node dist/src/cli.js --help
```

Or install the command globally:

```sh
npm install -g .
soak --help
```

## Quick start

```sh
node dist/src/cli.js init       # writes a template soak.json
node dist/src/cli.js validate   # checks the config
node dist/src/cli.js fetch      # downloads the forecast and soil moisture
node dist/src/cli.js status     # prints the advice per zone
```

Edit `soak.json` first. Set the garden location and the zones.
Each zone needs an `id`, a `name`, a `soil` type, and a `rootDepthM`.
Set `watering.precipRateMmPerHour` and `watering.efficiency` for minute-level advice.

## Example output

```
Backyard beds — garden status — 2026-10-21

toms · Tomato bed
  WATER NOW: 11.8 mm (53.1 L) in about 66 min
  soil is 61% depleted and rain will not cover it

herbs · Herb pots
  OK
  no action needed

Weather data: 2026-10-07 .. 2026-10-27 (0 h old)
Model: deficit calibrated to the soil moisture reading (0.2 m³/m³)
Tip: water in the early morning. Less evaporates.
```

Add `--json` for machine-readable output.

## Commands

### init

Writes a template `soak.json`. Refuses to overwrite without `--force`.

### validate

Checks the config file. Prints problems and warnings.

### fetch

Downloads 14 past days and 7 forecast days of daily ET0 and rain.
It also downloads the latest soil moisture reading (1-3 cm).
Values go into `data/cache/weather.json`.

### status

Shows the current advice per zone. Uses the cache. Run `fetch` first.

### plan

Shows the watering plan for the next 7 days. The plan assumes you follow the advice.
Use `--days <n>` (1-16) to change the length.

### log

Records a watering, or lists the log.

```sh
node dist/src/cli.js log --zone toms --date 2026-10-21 --mm 8
node dist/src/cli.js log --zone herbs --minutes 10 --note "pots top-up"
node dist/src/cli.js log --list
```

Give either `--mm` or `--minutes`. Minutes convert to millimetres through the zone's watering system.
The date defaults to today.

### export

Writes the water balance (history + forecast) as CSV or HTML.

```sh
node dist/src/cli.js export --out balance.csv
node dist/src/cli.js export --format html --out report.html
```

CSV columns: `date,zone_id,et0_mm,etc_mm,rain_mm,watering_mm,deficit_mm,depletion_pct`.

The HTML report is a single self-contained page. No external assets. No JavaScript.

### notify

Sends one ntfy message for zones that need water today.

```sh
node dist/src/cli.js notify --dry-run   # prints the message, sends nothing
node dist/src/cli.js notify             # sends through ntfy
```

Set `notify.topic` in the config first. `notify.server` defaults to `https://ntfy.sh`.

### demo

Runs fully offline with bundled sample data.

```sh
node dist/src/cli.js demo
node dist/src/cli.js demo --json
```

## How the model works

- Plant available water: PAW = AWC × rootDepthM. AWC comes from the soil table below.
- Daily crop loss: ETc = ET0 × kc. Mulched zones lose 30% less.
- Effective rain counts 80% of the forecast rain.
- The deficit grows with ETc. It shrinks with rain and logged waterings. It stays inside [0, PAW].
- The model starts from a full profile 14 days ago. When a soil moisture reading exists, it calibrates the current deficit to the reading.
- Advice: water when the deficit reaches `maxDepletion × PAW` (default 50%). Wait when rain covers the need. The minimum useful watering is 2 mm.
- Minutes = mm ÷ efficiency ÷ application rate × 60. Litres = mm × area (when `areaM2` is set).

| Soil       | AWC (mm/m) |
| ---------- | ---------- |
| sand       | 50         |
| sandy-loam | 100        |
| loam       | 160        |
| silt-loam  | 180        |
| clay-loam  | 150        |
| clay       | 140        |

## Data source

Open-Meteo forecast API, no key required: `https://api.open-meteo.com/v1/forecast`.

- Daily variables: `et0_fao_evapotranspiration`, `precipitation_sum`.
- Soil moisture: `soil_moisture_1_to_3cm` (m³/m³).
- Times are local to the garden (`timezone=auto`).
- The tool fetches 14 past days and 7 forecast days. It stays inside the free tier.

## Data files

- `data/cache/weather.json` — weather and soil moisture cache
- `data/waterings.jsonl` — watering log, one JSON object per line

The `data/` directory and `soak.json` are gitignored.

## Exit codes

- 0: success
- 1: runtime error (missing cache, refused overwrite)
- 2: usage error (bad flags or command)
- 3: config error

## Scheduled checks

Run `fetch` and `notify` from cron or a scheduler. Example, daily at 06:00:

```sh
node dist/src/cli.js fetch && node dist/src/cli.js notify
```

## Status

v0.1.0. The specification is in SPEC.md. Built spec-first.

## License

MIT