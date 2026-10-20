# soak — SPEC (v0.1)

A garden watering advisor.
It estimates the daily soil-water loss from free weather data.
Then it says when to water, how long to water, and when rain makes watering pointless.

Build date: 2026-10-21. Build harness: DSH (spec-first).

## Goals

- Track the root-zone water deficit for each garden zone.
- Use free Open-Meteo data. No API keys. No sensors.
- Advise when to water (now, soon, wait) and for how many minutes.
- Tell the gardener when rain makes watering pointless.
- Plan the next 7 days of watering per zone.
- Record waterings in a log. The model subtracts them.
- Export a CSV record and a small static HTML report.
- Send reminders through ntfy.
- Zero runtime dependencies. Node >= 20.

## Non-goals (v1)

- Interactive web UI. The CLI prints text, JSON, CSV, or writes a static HTML file.
- Per-zone microclimate. All zones share the garden location from the config.
- SQLite. JSON files work on Node >= 20 without setup.
- Direct valve or tap control. The tool advises. The gardener acts.

## Data sources (verified 2026-10-21)

Open-Meteo forecast API. No key required.

- Base URL: `https://api.open-meteo.com/v1/forecast`
- Daily variables: `et0_fao_evapotranspiration` (mm) and `precipitation_sum` (mm).
- Soil moisture variable: `soil_moisture_1_to_3cm` (m³/m³). Optional seed for the model.
- `timezone=auto` returns local times for the garden.
- `past_days` up to 92. `forecast_days` up to 16.
- Error responses use status 400 and `{"reason":"...","error":true}`.

soak fetches 14 past days + 7 forecast days (daily values), and the latest soil moisture value.

## Soil table

| Soil | Field capacity (v/v) | Wilting point (v/v) | AWC (mm/m) |
| ---- | ---- | ---- | ---- |
| sand | 0.10 | 0.05 | 50 |
| sandy-loam | 0.18 | 0.08 | 100 |
| loam | 0.30 | 0.14 | 160 |
| silt-loam | 0.34 | 0.16 | 180 |
| clay-loam | 0.36 | 0.21 | 150 |
| clay | 0.40 | 0.26 | 140 |

## Water model

Per zone, a root-zone bucket:

- PAW (mm) = AWC (mm/m) × rootDepthM.
- Daily crop loss ETc = ET0 × kc. A mulched zone loses 30% less: ETc × 0.7.
- Effective rain = 0.8 × rain (runoff and evaporation losses).
- Deficit D: starts at zero, grows with ETc, shrinks with rain and logged waterings. It stays inside [0, PAW].
- Start: D = 0 at the start of the history window (a full profile 14 days ago).
- Calibration: when a soil moisture reading exists, the model resets D at the end of the most recent completed day: D = (1 − sRel) × PAW, with sRel = clamp01((sm − wp) / (fc − wp)).
- MAD (mm) = maxDepletion × PAW. Default maxDepletion = 0.5.

## Advice rules

For a zone at deficit D, with effective rain rainSumEff over the next rainLookaheadDays (default 2, starting today):

- If D ≥ MAD:
  - If rainSumEff ≥ D, then "wait". Rain covers the need.
  - Else need = D − rainSumEff. If need < 2 mm, then "wait". Rain nearly covers it.
  - Else "water" with need mm. Give litres (when areaM2 is set) and minutes.
- Else if D ≥ 0.8 × MAD, then "soon". Check again tomorrow.
- Else "ok". No action.

Minutes = ceil((need_mm / efficiency) / precipRateMmPerHour × 60). Defaults: 10 mm/h, 0.85.
Litres = need_mm × areaM2 when areaM2 is set (1 mm over 1 m² is 1 L).

The current state is the end of yesterday. Today's advice uses the rain forecast from today. This keeps daily granularity.

## Commands

- `soak init` — write a template soak.json.
- `soak validate` — check the config. Print errors and warnings.
- `soak fetch` — download weather + soil moisture into the cache.
- `soak status` — show the current advice per zone.
- `soak plan` — show the watering plan for the next 7 days.
- `soak log` — record a watering, or list the log.
- `soak export` — write the water balance as CSV or HTML.
- `soak notify` — send ntfy alerts for zones that need water.
- `soak demo` — run offline with bundled sample data.

Options: `--config <file>` (default soak.json), `--json`, `--offline`, `--force`, `--now <ISO>`, `--zone <id>`, `--date`, `--mm`, `--minutes`, `--note`, `--list`, `--format csv|html`, `--out <file>`, `--dry-run`, `-h`, `-v`.

## Config keys (soak.json)

- `version`: 1.
- `dataDir`: directory for cache and log. Default "data".
- `garden`: `name` (optional), `latitude`, `longitude`.
- `zones[]`: `id`, `name`, `areaM2` (optional), `soil` (one of the table), `rootDepthM`, `kc` (optional), `mulched` (optional), `maxDepletion` (optional, 0.2–0.8), `watering` (optional): `precipRateMmPerHour`, `efficiency`.
- `weather`: `cacheHours` (default 6), `rainLookaheadDays` (default 2).
- `notify`: `server`, `topic`.

## Data files

- `data/cache/weather.json` — weather + soil moisture cache.
- `data/waterings.jsonl` — watering log. One JSON object per line.

## Export formats

- CSV columns: `date,zone_id,et0_mm,etc_mm,rain_mm,watering_mm,deficit_mm,depletion_pct`.
- HTML: a self-contained page with advice cards and a daily table. No external assets. No JavaScript.

## Acceptance criteria

- `npm run build` passes with TypeScript strict. No runtime dependencies.
- `npm test` passes. Tests use `node:test` via `node --test "dist/test/**/*.test.js"`.
- `fetch`, `status`, and `plan` work against live Open-Meteo for a Sydney garden.
- `demo` works with no network.
- `export` writes valid CSV with the documented headers, and an HTML report that opens in a browser.
- README shows install, build, and usage. Examples ship in `examples/`.
- Node >= 20.