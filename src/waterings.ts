/**
 * Watering log store.
 *
 * One JSON object per line (JSONL) in data/waterings.jsonl.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SoakConfig, ZoneConfig } from "./config.js";
import { isIsoDate, isoNow, round2 } from "./util.js";
import { appliedMmFromMinutes } from "./water.js";

export interface WateringEvent {
  id: string;
  zoneId: string;
  date: string;
  mm: number;
  minutes?: number;
  note?: string;
  createdAt: string;
}

export interface WateringInput {
  zoneId: string;
  date: string;
  mm?: number;
  minutes?: number;
  note?: string;
}

export function wateringsPath(dataDir: string): string {
  return join(dataDir, "waterings.jsonl");
}

export function validateWateringInput(input: WateringInput, config: SoakConfig): string[] {
  const issues: string[] = [];
  if (!config.zones.some((zone) => zone.id === input.zoneId)) {
    issues.push(`unknown zone: ${input.zoneId}`);
  }
  if (!isIsoDate(input.date)) {
    issues.push(`date must be YYYY-MM-DD, got: ${input.date}`);
  }
  const hasMm = input.mm !== undefined;
  const hasMinutes = input.minutes !== undefined;
  if (!hasMm && !hasMinutes) {
    issues.push("give an amount: --mm or --minutes");
  }
  if (hasMm && hasMinutes) {
    issues.push("give either --mm or --minutes, not both");
  }
  if (hasMm && (typeof input.mm !== "number" || !Number.isFinite(input.mm) || input.mm <= 0)) {
    issues.push("mm must be a positive number");
  }
  if (
    hasMinutes &&
    (typeof input.minutes !== "number" || !Number.isFinite(input.minutes) || input.minutes <= 0)
  ) {
    issues.push("minutes must be a positive number");
  }
  if (input.note !== undefined && typeof input.note !== "string") {
    issues.push("note must be a string");
  }
  return issues;
}

export function loadWaterings(dataDir: string): WateringEvent[] {
  const path = wateringsPath(dataDir);
  if (!existsSync(path)) {
    return [];
  }
  const events: WateringEvent[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const data: unknown = JSON.parse(line);
      if (
        typeof data === "object" &&
        data !== null &&
        typeof (data as WateringEvent).id === "string" &&
        typeof (data as WateringEvent).zoneId === "string" &&
        typeof (data as WateringEvent).date === "string" &&
        typeof (data as WateringEvent).mm === "number"
      ) {
        events.push(data as WateringEvent);
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return events;
}

export function addWatering(
  config: SoakConfig,
  input: WateringInput,
  now: Date = new Date(),
): WateringEvent {
  const issues = validateWateringInput(input, config);
  if (issues.length > 0) {
    throw new Error(issues.join(". "));
  }
  const zone = config.zones.find((z) => z.id === input.zoneId) as ZoneConfig;
  const mm =
    input.mm !== undefined
      ? round2(input.mm)
      : round2(appliedMmFromMinutes(zone, input.minutes as number));
  const existing = loadWaterings(config.dataDir).filter(
    (event) => event.zoneId === input.zoneId && event.date === input.date,
  );
  const id = `w-${input.zoneId}-${input.date.replaceAll("-", "")}-${existing.length + 1}`;
  const event: WateringEvent = {
    id,
    zoneId: input.zoneId,
    date: input.date,
    mm,
    ...(input.minutes !== undefined ? { minutes: round2(input.minutes) } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    createdAt: isoNow(now),
  };
  const path = wateringsPath(config.dataDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return event;
}

/** Sum of logged millimetres per date for one zone. */
export function wateringsByDate(events: WateringEvent[], zoneId: string): Record<string, number> {
  const byDate: Record<string, number> = {};
  for (const event of events) {
    if (event.zoneId !== zoneId) {
      continue;
    }
    byDate[event.date] = (byDate[event.date] ?? 0) + event.mm;
  }
  return byDate;
}