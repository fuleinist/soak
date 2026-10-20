import assert from "node:assert/strict";
import { test } from "node:test";

import { awcMmPerM, isSoilType, SOIL_PROPERTIES, SOIL_TYPES } from "../src/soils.js";

test("the soil table has six entries", () => {
  assert.equal(SOIL_TYPES.length, 6);
  for (const soil of SOIL_TYPES) {
    assert.ok(SOIL_PROPERTIES[soil], `missing properties for ${soil}`);
  }
});

test("AWC values match the documented table", () => {
  assert.equal(awcMmPerM("sand"), 50);
  assert.equal(awcMmPerM("sandy-loam"), 100);
  assert.equal(awcMmPerM("loam"), 160);
  assert.equal(awcMmPerM("silt-loam"), 180);
  assert.equal(awcMmPerM("clay-loam"), 150);
  assert.equal(awcMmPerM("clay"), 140);
});

test("field capacity stays above the wilting point", () => {
  for (const soil of SOIL_TYPES) {
    const props = SOIL_PROPERTIES[soil];
    assert.ok(props.fieldCapacity > props.wiltingPoint, `${soil} table row is inverted`);
  }
});

test("isSoilType guards the enum", () => {
  assert.equal(isSoilType("loam"), true);
  assert.equal(isSoilType("Loam"), false);
  assert.equal(isSoilType("moon-dust"), false);
  assert.equal(isSoilType(5), false);
  assert.equal(isSoilType(undefined), false);
});