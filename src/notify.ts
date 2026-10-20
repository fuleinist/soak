/**
 * ntfy notifications.
 */
import type { ZoneAdvice } from "./advisor.js";
import { round1 } from "./util.js";

/** Build the alert message, or null when no zone needs water. */
export function buildAlert(advices: ZoneAdvice[]): string | null {
  const due = advices.filter((advice) => advice.verdict === "water");
  if (due.length === 0) {
    return null;
  }
  const lines = [
    `soak: ${due.length} zone${due.length === 1 ? "" : "s"} ${due.length === 1 ? "needs" : "need"} water today`,
  ];
  for (const advice of due) {
    const litres = advice.litres !== null && advice.litres !== undefined ? ` (${round1(advice.litres)} L)` : "";
    lines.push(`- ${advice.zoneName}: ${round1(advice.needMm ?? 0)} mm${litres}, about ${advice.minutes} min`);
  }
  lines.push("Tip: water in the early morning. Less evaporates.");
  return lines.join("\n");
}

export async function sendNtfy(
  server: string,
  topic: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const base = server.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(topic)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    body: message,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`ntfy returned HTTP ${res.status}`);
  }
}