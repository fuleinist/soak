/**
 * Soil properties: field capacity, wilting point, and available water capacity.
 */
export const SOIL_TYPES = [
  "sand",
  "sandy-loam",
  "loam",
  "silt-loam",
  "clay-loam",
  "clay",
] as const;

export type SoilType = (typeof SOIL_TYPES)[number];

export interface SoilProperties {
  /** Field capacity, volumetric (m³/m³). */
  fieldCapacity: number;
  /** Wilting point, volumetric (m³/m³). */
  wiltingPoint: number;
}

export const SOIL_PROPERTIES: Record<SoilType, SoilProperties> = {
  sand: { fieldCapacity: 0.1, wiltingPoint: 0.05 },
  "sandy-loam": { fieldCapacity: 0.18, wiltingPoint: 0.08 },
  loam: { fieldCapacity: 0.3, wiltingPoint: 0.14 },
  "silt-loam": { fieldCapacity: 0.34, wiltingPoint: 0.16 },
  "clay-loam": { fieldCapacity: 0.36, wiltingPoint: 0.21 },
  clay: { fieldCapacity: 0.4, wiltingPoint: 0.26 },
};

/** Available water capacity in mm per metre of soil depth. */
export function awcMmPerM(soil: SoilType): number {
  const props = SOIL_PROPERTIES[soil];
  // Round to 3 decimals to absorb binary float noise (e.g. 0.18 - 0.08).
  return Math.round((props.fieldCapacity - props.wiltingPoint) * 1000 * 1000) / 1000;
}

export function isSoilType(value: unknown): value is SoilType {
  return typeof value === "string" && (SOIL_TYPES as readonly string[]).includes(value);
}