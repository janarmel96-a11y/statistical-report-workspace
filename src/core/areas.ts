// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { Engine } from './engine';
import { pickPlan } from './insights';
import type { Cell, Constraint } from './types';

/** Lets a report be narrowed to chosen places, from the widest level (region) to the narrowest (barangay). */

export type AreaPick = Record<string, Cell[]>;
export interface AreaOption { value: Cell; label: string; count: number }

export const areaLevels = (en: Engine): string[] => pickPlan(en).groups.location;

const constraint = (col: string, values: Cell[]): Constraint => ({ col, kind: 'in', values });

export const areaConstraints = (pick: AreaPick): Constraint[] =>
  Object.entries(pick).filter(([, values]) => values.length).map(([col, values]) => constraint(col, values));

/** The places at one level, limited to those inside anything picked at a wider level. */
export function areaOptions(en: Engine, levels: string[], pick: AreaPick, col: string): AreaOption[] {
  const wider = levels.slice(0, Math.max(0, levels.indexOf(col))).filter((l) => pick[l]?.length).map((l) => constraint(l, pick[l]));
  return [...en.groupRows(wider, { col }).entries()]
    .filter(([value]) => value !== null)
    .map(([value, rows]) => ({ value, label: String(value), count: rows.length }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Drops picks that no longer exist after a wider level changes. */
export function tidyAreas(en: Engine, levels: string[], pick: AreaPick): AreaPick {
  const out: AreaPick = {};
  for (const col of levels) {
    const valid = new Set(areaOptions(en, levels, out, col).map((o) => o.value));
    const kept = (pick[col] ?? []).filter((v) => valid.has(v));
    if (kept.length) out[col] = kept;
  }
  return out;
}

/** Keeps long lists readable when they are shown on a slide or read aloud. */
export function listLabels(labels: string[], limit = 6): string {
  if (labels.length <= limit) return labels.join(', ');
  return `${labels.slice(0, limit).join(', ')}, and ${labels.length - limit} more`;
}

export const areaSummary = (levels: string[], pick: AreaPick): string =>
  levels.filter((l) => pick[l]?.length).map((l) => `${l}: ${listLabels(pick[l].map(String))}`).join('; ');
