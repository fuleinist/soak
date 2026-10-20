import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDays,
  clamp,
  formatMm,
  isIsoDate,
  isoNow,
  localDateISO,
  pad2,
  round1,
  round2,
  slugify,
  todayISO,
} from "../src/util.js";

test("pad2 pads single digits", () => {
  assert.equal(pad2(3), "03");
  assert.equal(pad2(11), "11");
  assert.equal(pad2(0), "00");
});

test("isoNow returns the UTC instant", () => {
  const date = new Date("2026-10-21T06:00:00+11:00");
  assert.equal(isoNow(date), "2026-10-20T19:00:00.000Z");
});

test("todayISO returns the UTC date", () => {
  const date = new Date("2026-10-21T06:00:00+11:00");
  assert.equal(todayISO(date), "2026-10-20");
});

test("localDateISO respects the time zone", () => {
  const date = new Date("2026-10-20T19:00:00Z");
  assert.equal(localDateISO(date, "Australia/Sydney"), "2026-10-21");
  assert.equal(localDateISO(date, "UTC"), "2026-10-20");
  assert.equal(localDateISO(date, "America/Los_Angeles"), "2026-10-20");
});

test("localDateISO survives an unknown time zone", () => {
  const date = new Date("2026-10-20T19:00:00Z");
  assert.match(localDateISO(date, "Not/AZone"), /^\d{4}-\d{2}-\d{2}$/);
});

test("isIsoDate accepts real dates only", () => {
  assert.equal(isIsoDate("2026-10-21"), true);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2027-02-29"), false);
  assert.equal(isIsoDate("21-10-2026"), false);
  assert.equal(isIsoDate("2026-1-1"), false);
  assert.equal(isIsoDate(""), false);
});

test("addDays walks across month and year boundaries", () => {
  assert.equal(addDays("2026-10-21", 1), "2026-10-22");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-10-21", 0), "2026-10-21");
  assert.equal(addDays("2026-12-31", 7), "2027-01-07");
});

test("clamp keeps values inside the range", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("slugify produces url-friendly text", () => {
  assert.equal(slugify("Tomato Bed!"), "tomato-bed");
  assert.equal(slugify("  spaces  "), "spaces");
  assert.equal(slugify("already-fine"), "already-fine");
});

test("round1 and formatMm render friendly numbers", () => {
  assert.equal(round1(1.24), 1.2);
  assert.equal(round1(1.25), 1.3);
  assert.equal(round1(2), 2);
  assert.equal(formatMm(3.25), "3.3 mm");
  assert.equal(formatMm(0), "0 mm");
});

test("round2 rounds to two decimals", () => {
  assert.equal(round2(3.14159), 3.14);
  assert.equal(round2(10.086), 10.09);
  assert.equal(round2(5), 5);
});