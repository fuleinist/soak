import assert from "node:assert/strict";
import { test } from "node:test";

import type { ZoneAdvice } from "../src/advisor.js";
import { buildAlert, sendNtfy } from "../src/notify.js";

function advice(overrides: Partial<ZoneAdvice>): ZoneAdvice {
  return {
    zoneId: "toms",
    zoneName: "Tomato bed",
    verdict: "ok",
    stateDate: "2026-10-20",
    deficitMm: 0,
    depletion: 0,
    depletionPct: 0,
    pawMm: 48,
    madMm: 19.2,
    rainSumMm: 0,
    lookaheadDays: 2,
    reason: "no action needed",
    ...overrides,
  };
}

test("buildAlert returns null when no zone needs water", () => {
  assert.equal(buildAlert([advice({ verdict: "ok" })]), null);
  assert.equal(
    buildAlert([advice({ verdict: "wait", reason: "rain covers the deficit (8.4 mm expected)" })]),
    null,
  );
});

test("buildAlert lists zones that need water", () => {
  const alert = buildAlert([
    advice({ verdict: "water", needMm: 12.1, minutes: 67, litres: 54 }),
    advice({ zoneId: "herbs", zoneName: "Herb pots", verdict: "water", needMm: 5, minutes: 44, litres: 6 }),
    advice({ zoneId: "lawn", zoneName: "Lawn", verdict: "ok" }),
  ]);
  assert.ok(alert);
  assert.ok(alert.includes("2 zones need water today"));
  assert.ok(alert.includes("- Tomato bed: 12.1 mm (54 L), about 67 min"));
  assert.ok(alert.includes("- Herb pots: 5 mm (6 L), about 44 min"));
  assert.ok(alert.includes("water in the early morning"));
});

test("buildAlert uses singular grammar for one zone", () => {
  const alert = buildAlert([advice({ verdict: "water", needMm: 5, minutes: 44, litres: 6 })]);
  assert.ok(alert?.includes("1 zone needs water today"));
});

test("sendNtfy posts the message", async () => {
  let url = "";
  let method = "";
  let body = "";
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    url = String(input);
    method = init?.method ?? "";
    body = String(init?.body ?? "");
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  await sendNtfy("https://ntfy.sh/", "soak-test", "hello", fakeFetch);
  assert.equal(url, "https://ntfy.sh/soak-test");
  assert.equal(method, "POST");
  assert.equal(body, "hello");
});

test("sendNtfy reports HTTP errors", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(() => sendNtfy("https://ntfy.sh", "t", "m", fakeFetch), /HTTP 500/);
});