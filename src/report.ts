/**
 * Text and JSON reports.
 */
import { VERDICT_LABELS as LABELS, type PlanEntry, type ZoneAdvice, type ZonePlan } from "./advisor.js";
import { formatMm, round1 } from "./util.js";

export interface StatusMeta {
  today: string;
  gardenName?: string;
  fetchedAt: string;
  ageHours: number;
  dataRange: { start: string; end: string } | null;
  modelNote: string | null;
  missingValues: number;
}

export function amountText(
  needMm: number | undefined,
  litres: number | null | undefined,
  minutes: number | undefined,
): string {
  const parts = [formatMm(needMm ?? 0)];
  if (litres !== null && litres !== undefined) {
    parts.push(`(${round1(litres)} L)`);
  }
  parts.push(`in about ${minutes ?? 0} min`);
  return parts.join(" ");
}

export function formatStatusText(advices: ZoneAdvice[], meta: StatusMeta): string {
  const lines: string[] = [];
  const title = meta.gardenName ? `${meta.gardenName} — garden status` : "Garden status";
  lines.push(`${title} — ${meta.today}`);
  lines.push("");
  for (const advice of advices) {
    lines.push(`${advice.zoneId} · ${advice.zoneName}`);
    if (advice.verdict === "water") {
      lines.push(`  ${LABELS[advice.verdict]}: ${amountText(advice.needMm, advice.litres, advice.minutes)}`);
    } else {
      lines.push(`  ${LABELS[advice.verdict]}`);
    }
    lines.push(`  ${advice.reason}`);
    lines.push("");
  }
  if (meta.dataRange) {
    lines.push(
      `Weather data: ${meta.dataRange.start} .. ${meta.dataRange.end} (${round1(meta.ageHours)} h old)`,
    );
  }
  if (meta.modelNote) {
    lines.push(`Model: ${meta.modelNote}`);
  }
  if (meta.missingValues > 0) {
    lines.push(`Warning: ${meta.missingValues} missing value(s) in the weather data.`);
  }
  lines.push("Tip: water in the early morning. Less evaporates.");
  return lines.join("\n");
}

export function statusJson(advices: ZoneAdvice[], meta: StatusMeta): Record<string, unknown> {
  return {
    generatedFor: meta.today,
    garden: meta.gardenName ?? null,
    weather: {
      fetchedAt: meta.fetchedAt,
      ageHours: round1(meta.ageHours),
      range: meta.dataRange,
      missingValues: meta.missingValues,
    },
    model: meta.modelNote,
    zones: advices,
  };
}

export interface PlanMeta {
  today: string;
  days: number;
  gardenName?: string;
}

function planEntryAmount(entry: PlanEntry): string {
  return amountText(entry.needMm, entry.litres, entry.minutes);
}

export function formatPlanText(plans: ZonePlan[], meta: PlanMeta): string {
  const lines: string[] = [];
  const title = meta.gardenName ? `${meta.gardenName} — watering plan` : "Watering plan";
  lines.push(`${title} — next ${meta.days} days (${meta.today})`);
  lines.push("");
  for (const plan of plans) {
    lines.push(`${plan.zoneId} · ${plan.zoneName}`);
    const actionable = plan.entries.filter((entry) => entry.verdict !== "ok");
    if (actionable.length === 0) {
      lines.push("  No action needed this week.");
    } else {
      for (const entry of actionable) {
        const suffix = entry.verdict === "water" ? `: ${planEntryAmount(entry)}` : "";
        lines.push(`  ${entry.date}  ${LABELS[entry.verdict]}${suffix}`);
        lines.push(`    ${entry.reason}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function planJson(plans: ZonePlan[], meta: PlanMeta): Record<string, unknown> {
  return {
    generatedFor: meta.today,
    garden: meta.gardenName ?? null,
    days: meta.days,
    zones: plans,
  };
}