// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { findOverlaps, matchColumns } from './combine';
import { uniqueHeaders } from './parse';
import type { Finding, RawTable } from './types';

/** Decisions for automatic mode, where a report is generated without any review step. */

export interface AutoPick {
  tables: RawTable[];
  combine: { mode: 'single' | 'append' };
  skipped: string[];
  /** Tables left out because another table already holds all of their rows. */
  repeated: string[];
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
  let shaped: RawTable[] = [];
  let bestSize = -1;
  groups.forEach((list) => {
    const size = list.reduce((s, t) => s + sizeOf(t), 0);
    if (size > bestSize) { shaped = list; bestSize = size; }
  });
  // Files with the same header content are the same kind of data, even if their columns are in another order
  // or one form has a few extra questions. Files with different headers are never combined.
  const anchor = shaped[0];
  const related = (t: RawTable) => {
    if (shaped.includes(t)) return true;
    const both = matchColumns([{ name: 'a', headers: anchor.headers, rows: [] }, { name: 'b', headers: t.headers, rows: [] }]).filter((c) => c.map.every((p) => p !== null)).length;
    return both / Math.min(anchor.headers.length, t.headers.length) >= 0.9;
  };
  const candidates = found.filter(related);
  // A master sheet next to its monthly sheets, or the same file twice, would count every row twice.
  const overlaps = findOverlaps(candidates.map((t) => ({ name: t.name, headers: t.headers.map((h) => String(h ?? '').trim()), rows: t.rows })));
  const inside = new Set(overlaps.map((o) => o.table));
  const best = candidates.filter((_, i) => !inside.has(i));
  const labels = tableLabels(candidates);
  const repeated = overlaps.map((o) => `${labels[o.table]} (${o.same ? 'same rows as' : 'already inside'} ${labels[o.within]})`);
  return {
    tables: best,
    combine: { mode: best.length > 1 ? 'append' : 'single' },
    skipped: found.filter((t) => !candidates.includes(t)).map((t) => t.name),
    repeated,
  };
}

/** File names are clearer than sheet names when several files use the same sheet name. */
export function tableLabels(tables: RawTable[]): string[] {
  const unique = new Set(tables.map((t) => t.name)).size === tables.length;
  return tables.map((t) => (unique ? t.name : t.source.replace(/\.[^.]+$/, '')));
}

export interface AutoSummary {
  used: string;
  rows: number;
  corrected: number;
  removedRows: number;
  labelsFixed: number;
  review: number;
  skipped: string[];
  repeated: string[];
  note?: string;
}

/** What automatic mode changed, so the person can see it without opening the review screen. */
export function summarizeAuto(pick: AutoPick, findings: Finding[], disabled: string[], rows: number): AutoSummary {
  const applied = findings.filter((f) => !disabled.includes(f.id));
  return {
    used: tableLabels(pick.tables).join(', '),
    rows,
    corrected: applied.filter((f) => f.kind === 'wrong-calculation' || f.kind === 'impossible-age').reduce((n, f) => n + f.changes.length, 0),
    removedRows: applied.flatMap((f) => f.steps).reduce((n, s) => n + (s.op === 'excludeRows' ? s.rows.length : 0), 0),
    labelsFixed: applied.filter((f) => f.kind === 'label-variants').reduce((n, f) => n + f.count, 0),
    review: findings.filter((f) => !f.auto && f.severity !== 'info').length,
    skipped: pick.skipped,
    repeated: pick.repeated,
    note: pick.tables.find((t) => t.note)?.note,
  };
}
