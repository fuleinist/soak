/**
 * soak config: types, defaults, loading, and validation.
 */
import { readFileSync } from "node:fs";

import { isSoilType, SOIL_TYPES } from "./soils.js";

export interface WateringSystemConfig {
  /** Application rate in mm per hour. Default: 10. */
  precipRateMmPerHour?: number;
  /** Application efficiency (0-1). Default: 0.85. */
  efficiency?: number;
}

export interface ZoneConfig {
  id: string;
  name: string;
  /** Bed area in m². Optional. Used for litres. */
  areaM2?: number;
  soil: string;
  /** Effective root depth in metres. */
  rootDepthM: number;
  /** Crop coefficient. Default: 1.0. */
  kc?: number;
  /** Mulch reduces evaporation by 30%. Default: false. */
  mulched?: boolean;
  /** Fraction of PAW allowed to deplete before watering (0.2-0.8). Default: 0.5. */
  maxDepletion?: number;
  watering?: WateringSystemConfig;
}

export interface GardenConfig {
  name?: string;
  latitude: number;
  longitude: number;
}

export interface WeatherConfig {
  /** Hours before the cached forecast counts as stale. Default: 6. */
  cacheHours?: number;
  /** Days to look ahead for rain. Default: 2. */
  rainLookaheadDays?: number;
}

export interface NotifyConfig {
  server?: string;
  topic?: string;
}

export interface SoakConfig {
  version: 1;
  dataDir: string;
  garden: GardenConfig;
  zones: ZoneConfig[];
  weather?: WeatherConfig;
  notify?: NotifyConfig;
}

export class ConfigError extends Error {}

export const DEFAULT_CACHE_HOURS = 6;
export const DEFAULT_RAIN_LOOKAHEAD_DAYS = 2;
export const DEFAULT_PRECIP_RATE_MM_PER_HOUR = 10;
export const DEFAULT_EFFICIENCY = 0.85;
export const DEFAULT_MAX_DEPLETION = 0.5;
export const DEFAULT_KC = 1;
/** Mulched zones lose 30% less water to evaporation. */
export const MULCH_FACTOR = 0.7;

export function defaultConfig(): SoakConfig {
  return {
    version: 1,
    dataDir: "data",
    garden: {
      name: "Backyard beds",
      latitude: -33.7254,
      longitude: 151.0487,
    },
    zones: [
      {
        id: "toms",
        name: "Tomato bed",
        areaM2: 4.5,
        soil: "loam",
        rootDepthM: 0.3,
        kc: 1.05,
        mulched: true,
        maxDepletion: 0.4,
        watering: { precipRateMmPerHour: 12, efficiency: 0.9 },
      },
      {
        id: "herbs",
        name: "Herb pots",
        areaM2: 1.2,
        soil: "sandy-loam",
        rootDepthM: 0.2,
        kc: 0.9,
        watering: { precipRateMmPerHour: 8, efficiency: 0.85 },
      },
    ],
    weather: { cacheHours: DEFAULT_CACHE_HOURS, rainLookaheadDays: DEFAULT_RAIN_LOOKAHEAD_DAYS },
    notify: { server: "https://ntfy.sh", topic: "" },
  };
}

export function loadConfigFile(path: string): SoakConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`cannot read config file: ${path}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ConfigError(`config file is not valid JSON: ${path}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError("config must be a JSON object");
  }
  return data as SoakConfig;
}

export function collectConfigIssues(config: SoakConfig): string[] {
  const issues: string[] = [];
  if (config.version !== 1) {
    issues.push("version must be 1");
  }
  if (typeof config.dataDir !== "string" || config.dataDir.length === 0) {
    issues.push("dataDir must be a non-empty string");
  }
  if (typeof config.garden !== "object" || config.garden === null) {
    issues.push("garden must be an object");
  } else {
    const garden = config.garden as GardenConfig;
    if (garden.name !== undefined && typeof garden.name !== "string") {
      issues.push("garden.name must be a string");
    }
    const lat = garden.latitude;
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      issues.push("garden.latitude must be a number between -90 and 90");
    }
    const lon = garden.longitude;
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      issues.push("garden.longitude must be a number between -180 and 180");
    }
  }
  if (config.notify !== undefined) {
    if (typeof config.notify !== "object" || config.notify === null) {
      issues.push("notify must be an object");
    } else {
      if (config.notify.server !== undefined && typeof config.notify.server !== "string") {
        issues.push("notify.server must be a string");
      }
      if (config.notify.topic !== undefined && typeof config.notify.topic !== "string") {
        issues.push("notify.topic must be a string");
      }
    }
  }
  if (config.weather !== undefined) {
    if (typeof config.weather !== "object" || config.weather === null) {
      issues.push("weather must be an object");
    } else {
      if (config.weather.cacheHours !== undefined) {
        const hours = config.weather.cacheHours;
        if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
          issues.push("weather.cacheHours must be a positive number");
        }
      }
      if (config.weather.rainLookaheadDays !== undefined) {
        const days = config.weather.rainLookaheadDays;
        if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 5) {
          issues.push("weather.rainLookaheadDays must be an integer between 0 and 5");
        }
      }
    }
  }
  if (!Array.isArray(config.zones) || config.zones.length === 0) {
    issues.push("zones must be a non-empty array");
    return issues;
  }
  const seen = new Set<string>();
  for (const [index, rawZone] of config.zones.entries()) {
    const label = `zones[${index}]`;
    if (typeof rawZone !== "object" || rawZone === null) {
      issues.push(`${label} must be an object`);
      continue;
    }
    const zone = rawZone as ZoneConfig;
    if (typeof zone.id !== "string" || zone.id.length === 0) {
      issues.push(`${label}.id must be a non-empty string`);
    } else if (seen.has(zone.id)) {
      issues.push(`${label}.id is a duplicate: ${zone.id}`);
    } else {
      seen.add(zone.id);
    }
    if (typeof zone.name !== "string" || zone.name.length === 0) {
      issues.push(`${label}.name must be a non-empty string`);
    }
    if (!isSoilType(zone.soil)) {
      issues.push(`${label}.soil must be one of: ${SOIL_TYPES.join(", ")}`);
    }
    const depth = zone.rootDepthM;
    if (typeof depth !== "number" || !Number.isFinite(depth) || depth <= 0 || depth > 5) {
      issues.push(`${label}.rootDepthM must be a number between 0 and 5`);
    }
    if (zone.kc !== undefined) {
      const kc = zone.kc;
      if (typeof kc !== "number" || !Number.isFinite(kc) || kc <= 0) {
        issues.push(`${label}.kc must be a positive number`);
      }
    }
    if (zone.mulched !== undefined && typeof zone.mulched !== "boolean") {
      issues.push(`${label}.mulched must be a boolean`);
    }
    if (zone.maxDepletion !== undefined) {
      const mad = zone.maxDepletion;
      if (typeof mad !== "number" || !Number.isFinite(mad) || mad < 0.2 || mad > 0.8) {
        issues.push(`${label}.maxDepletion must be a number between 0.2 and 0.8`);
      }
    }
    if (zone.areaM2 !== undefined) {
      const area = zone.areaM2;
      if (typeof area !== "number" || !Number.isFinite(area) || area <= 0) {
        issues.push(`${label}.areaM2 must be a positive number`);
      }
    }
    if (zone.watering !== undefined) {
      if (typeof zone.watering !== "object" || zone.watering === null) {
        issues.push(`${label}.watering must be an object`);
      } else {
        const rate = zone.watering.precipRateMmPerHour;
        if (rate !== undefined && (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)) {
          issues.push(`${label}.watering.precipRateMmPerHour must be a positive number`);
        }
        const eff = zone.watering.efficiency;
        if (eff !== undefined && (typeof eff !== "number" || !Number.isFinite(eff) || eff <= 0 || eff > 1)) {
          issues.push(`${label}.watering.efficiency must be a number between 0 and 1`);
        }
      }
    }
  }
  return issues;
}

export function collectConfigWarnings(config: SoakConfig): string[] {
  const warnings: string[] = [];
  if (typeof config.garden === "object" && config.garden !== null) {
    if (!config.garden.name) {
      warnings.push("garden.name is missing; reports show no garden name");
    }
  }
  if (Array.isArray(config.zones)) {
    for (const [index, rawZone] of config.zones.entries()) {
      if (typeof rawZone !== "object" || rawZone === null) {
        continue;
      }
      const zone = rawZone as ZoneConfig;
      if (typeof zone.id !== "string" || zone.id.length === 0) {
        continue;
      }
      if (zone.id !== zone.id.trim()) {
        warnings.push(`zones[${index}].id has leading or trailing spaces`);
      } else if (/[A-Z]/.test(zone.id)) {
        warnings.push(`zones[${index}].id "${zone.id}" is not lowercase; slugs are easier to type`);
      }
      if (
        typeof zone.id === "string" &&
        zone.id === zone.id.trim() &&
        !/[A-Z]/.test(zone.id) &&
        zone.watering === undefined
      ) {
        warnings.push(
          `zones[${index}].watering is missing; minutes use defaults (10 mm/h, 85% efficiency)`,
        );
      }
    }
  }
  if (config.notify && !config.notify.topic) {
    warnings.push("notify.topic is empty; the notify command cannot send messages");
  }
  return warnings;
}

export function effectiveKc(zone: ZoneConfig): number {
  return zone.kc ?? DEFAULT_KC;
}

export function isMulched(zone: ZoneConfig): boolean {
  return zone.mulched === true;
}

export function effectiveMaxDepletion(zone: ZoneConfig): number {
  return zone.maxDepletion ?? DEFAULT_MAX_DEPLETION;
}

export function effectiveWatering(zone: ZoneConfig): {
  precipRateMmPerHour: number;
  efficiency: number;
} {
  return {
    precipRateMmPerHour: zone.watering?.precipRateMmPerHour ?? DEFAULT_PRECIP_RATE_MM_PER_HOUR,
    efficiency: zone.watering?.efficiency ?? DEFAULT_EFFICIENCY,
  };
}