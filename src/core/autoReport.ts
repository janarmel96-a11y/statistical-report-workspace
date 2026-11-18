// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { uniqueHeaders } from './parse';
import type { Finding, RawTable } from './types';

/** Decisions for automatic mode, where a report is generated without any review step. */

export interface AutoPick {
  tables: RawTable[];
  combine: { mode: 'single' | 'append' };
  skipped: string[];
}

const sizeOf = (t: RawTable) => t.rows.length * t.headers.length * (t.confidence ?? 1);
const shapeOf = (t: RawTable) => uniqueHeaders(t.headers).map((h) => h.toLowerCase()).sort().join('|');

/**
 * Picks the main data. Tables with the same columns, such as monthly sheets, are stacked.
 * Otherwise the largest table is used, so small lookup or notes sheets never replace the data.
 */
export function chooseTables(found: RawTable[]): AutoPick {
  const groups = new Map<string, RawTable[]>();
  found.forEach((t) => groups.set(shapeOf(t), [...(groups.get(shapeOf(t)) ?? []), t]));
  let best: RawTable[] = [];
  let bestSize = -1;
  groups.forEach((list) => {
    const size = list.reduce((s, t) => s + sizeOf(t), 0);
    if (size > bestSize) { best = list; bestSize = size; }
  });
  return {
    tables: best,
    combine: { mode: best.length > 1 ? 'append' : 'single' },
    skipped: found.filter((t) => !best.includes(t)).map((t) => t.name),
  };
}

export interface AutoSummary {
  used: string;
  rows: number;
  corrected: number;
  removedRows: number;
  labelsFixed: number;
  review: number;
  skipped: string[];
  note?: string;
}

/** What automatic mode changed, so the person can see it without opening the review screen. */
export function summarizeAuto(pick: AutoPick, findings: Finding[], disabled: string[], rows: number): AutoSummary {
  const applied = findings.filter((f) => !disabled.includes(f.id));
  return {
    used: pick.tables.map((t) => t.name).join(', '),
    rows,
    corrected: applied.filter((f) => f.kind === 'wrong-calculation').reduce((n, f) => n + f.changes.length, 0),
    removedRows: applied.flatMap((f) => f.steps).reduce((n, s) => n + (s.op === 'excludeRows' ? s.rows.length : 0), 0),
    labelsFixed: applied.filter((f) => f.kind === 'label-variants').reduce((n, f) => n + f.count, 0),
    review: findings.filter((f) => !f.auto && f.severity !== 'info').length,
    skipped: pick.skipped,
    note: pick.tables.find((t) => t.note)?.note,
  };
}
