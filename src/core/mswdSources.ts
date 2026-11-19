// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { combineSources, findOverlaps, matchColumns, type CombineSource } from './combine';
import { detectColumns } from './mswd';
import type { RawCell, RawTable } from './types';

/**
 * Chooses which uploaded sheets make up MASTER DATA. The NEW and OLD patient responses, or one file per month,
 * are stacked. A finished report workbook is read too: its MASTER DATA is used, and the monthly copies, the
 * dashboard helpers, and the summary sheets are left out so no patient is counted twice.
 */

export interface SourceTable { label: string; table: RawTable }
export interface SourceChoice { use: boolean; reason?: string }

const headersOf = (t: RawTable) => t.headers.map((h) => String(h ?? '').trim());
const asSource = (s: SourceTable): CombineSource => ({ name: s.label, headers: headersOf(s.table), rows: s.table.rows });

/** Share of the smaller table's columns that the two tables have in common. */
function sharedColumns(a: RawTable, b: RawTable): number {
  const both = matchColumns([{ name: 'a', headers: headersOf(a), rows: [] }, { name: 'b', headers: headersOf(b), rows: [] }])
    .filter((c) => c.map.every((p) => p !== null)).length;
  return both / Math.max(1, Math.min(a.headers.length, b.headers.length));
}

export function chooseSources(list: SourceTable[]): SourceChoice[] {
  const hasWorker = list.map((s) => s.table.rows.length > 0 && detectColumns(headersOf(s.table)).worker !== undefined);
  let main = -1;
  list.forEach((s, i) => { if (hasWorker[i] && (main < 0 || s.table.rows.length * s.table.headers.length > list[main].table.rows.length * list[main].table.headers.length)) main = i; });
  const out: SourceChoice[] = list.map((_, i) => (hasWorker[i] ? { use: true } : { use: false, reason: 'No Medical Social Worker column' }));
  if (main < 0) return out;
  list.forEach((s, i) => {
    if (i === main || !out[i].use) return;
    if (sharedColumns(list[main].table, s.table) < 0.6) out[i] = { use: false, reason: `Different columns from ${list[main].label}` };
  });
  const picked = list.map((_, i) => i).filter((i) => out[i].use);
  for (const o of findOverlaps(picked.map((i) => asSource(list[i])))) {
    out[picked[o.table]] = { use: false, reason: `${o.same ? 'Same rows as' : 'Already inside'} ${list[picked[o.within]].label}${o.byStamp ? ` (matched by ${o.byStamp}; some cells differ)` : ''}` };
  }
  return out;
}

/**
 * True when the upload is MSWD patient data: a Medical Social Worker column, a month or date, a type of patient
 * or classification, and a new or old patient status. Such files go to the MSWD performance report.
 */
export function isMswdUpload(tables: RawTable[]): boolean {
  const list = tables.map((t) => ({ label: t.name, table: t }));
  const choice = chooseSources(list);
  return list.some((s, i) => {
    if (!choice[i].use) return false;
    const c = detectColumns(headersOf(s.table));
    return c.worker !== undefined && (c.month ?? c.timestamp ?? c.date) !== undefined
      && (c.typeOfPatient !== undefined || c.classification !== undefined) && (c.patientStatus !== undefined || c.patientType !== undefined);
  });
}

/** Stacks the chosen tables, lining their columns up by header. */
export function stackSources(list: SourceTable[], use: boolean[]): { headers: string[]; rows: RawCell[][]; similar: string[][] } {
  const chosen = list.filter((_, i) => use[i]).map(asSource);
  if (!chosen.length) return { headers: [], rows: [], similar: [] };
  if (chosen.length === 1) return { headers: chosen[0].headers, rows: chosen[0].rows, similar: [] };
  const columns = matchColumns(chosen);
  const result = combineSources(chosen, columns, { addSource: false, sourceHeader: '', removeDuplicates: false });
  const similar = columns.filter((c) => c.similar).map((c) => c.map.flatMap((p, s) => (p === null ? [] : [chosen[s].headers[p]])));
  return { headers: result.headers, rows: result.rows, similar };
}
