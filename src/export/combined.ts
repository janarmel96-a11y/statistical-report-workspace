// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import * as XLSX from 'xlsx';
import type { CombineColumn, CombineResult, CombineSource } from '../core/combine';
import type { RawCell } from '../core/types';
import { csvEscape, safeSheetName, safeText } from './workbook';
import { cellRef, StyleBook, writeXlsx, type XCell, type XSheet } from './xlsxWriter';

const DAY = 86400000;
const isDate = (v: RawCell): v is { date: number } => typeof v === 'object' && v !== null;
const inExcelRange = (ms: number) => ms >= Date.UTC(1900, 2, 1) && ms <= Date.UTC(9999, 11, 31);
const dateText = (ms: number) => { const iso = new Date(ms).toISOString(); return ms % DAY === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' '); };

/** Writes the combined table. Dates stay dates, numbers stay numbers, and long IDs are never shortened. */
export async function buildCombinedWorkbook(sources: CombineSource[], columns: CombineColumn[], result: CombineResult): Promise<Uint8Array<ArrayBuffer>> {
  const styles = new StyleBook();
  const head = styles.add({ bold: true, size: 11, font: 'Calibri', fill: 'E8F0FB', valign: 'top', wrap: true });
  const bold = styles.add({ bold: true, size: 11, font: 'Calibri' });
  const day = styles.add({ size: 11, font: 'Calibri', numFmt: 'yyyy-mm-dd' });
  const stamp = styles.add({ size: 11, font: 'Calibri', numFmt: 'yyyy-mm-dd hh:mm:ss' });
  const whole = styles.add({ size: 11, font: 'Calibri', numFmt: '0' });
  const used = new Set<string>();
  const cell = (v: RawCell): XCell | null => {
    if (v === null || v === undefined) return null;
    if (isDate(v)) return inExcelRange(v.date) ? { date: v.date, s: v.date % DAY === 0 ? day : stamp } : { v: dateText(v.date) };
    if (typeof v === 'number') return Number.isFinite(v) ? { v, s: Number.isInteger(v) && Math.abs(v) >= 100000 ? whole : undefined } : null;
    return { v };
  };
  const combined: XSheet = {
    name: safeSheetName('Combined', used),
    cols: result.headers.map(() => ({ width: 20 })),
    freeze: { rows: 1, cols: 0 },
    autoFilter: result.headers.length ? `A1:${cellRef(Math.max(1, result.rows.length), result.headers.length - 1)}` : undefined,
    rows: function* () {
      yield { height: 48, cells: result.headers.map((h) => ({ v: safeText(h), s: head })) };
      for (const row of result.rows) yield { cells: row.map(cell) };
    },
  };
  const partial = columns.filter((c) => c.map.some((p) => p === null));
  const summary: XSheet = {
    name: safeSheetName('Combine Summary', used),
    cols: [{ width: 58 }, { width: 14 }, { width: 14 }],
    rows: function* () {
      yield { cells: ['File', 'Rows', 'Columns'].map((v) => ({ v, s: bold })) };
      for (const [i, s] of sources.entries()) yield { cells: [{ v: s.name }, { v: result.rowsPerSource[i] }, { v: s.headers.length }] };
      yield { cells: [{ v: 'Combined total', s: bold }, { v: result.rows.length, s: bold }, { v: result.headers.length, s: bold }] };
      if (result.duplicatesRemoved) yield { cells: [{ v: 'Exact duplicate rows removed' }, { v: result.duplicatesRemoved }] };
      if (!partial.length) return;
      yield { cells: [] };
      yield { cells: [{ v: 'Columns not found in every file', s: bold }, { v: 'Found in', s: bold }] };
      for (const c of partial) yield { cells: [{ v: c.name }, { v: c.map.flatMap((p, i) => (p === null ? [] : [sources[i].name])).join('; ') }] };
    },
  };
  return writeXlsx([combined, summary], styles);
}

/** Reopens the finished workbook and compares every cell with the combined table. */
export function verifyCombinedWorkbook(buf: ArrayBuffer | Uint8Array, result: CombineResult): void {
  const fail = (m: string): never => { throw new Error(`The combined file failed its safety check: ${m}`); };
  const wb = XLSX.read(buf instanceof Uint8Array ? buf : new Uint8Array(buf), { type: 'array', dense: true });
  const ws = wb.Sheets.Combined ?? fail('the combined sheet is missing');
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  if (range.e.r !== result.rows.length) fail('the row count changed');
  if (range.e.c + 1 !== result.headers.length) fail('the column count changed');
  result.rows.forEach((row, r) => row.forEach((v, c) => {
    const cell = ws['!data']?.[r + 1]?.[c] as XLSX.CellObject | undefined;
    if (v === null) { if (cell && cell.v !== '' && cell.v !== undefined) fail(`row ${r + 2} has an unexpected value`); return; }
    if (!cell) fail(`row ${r + 2}, column ${c + 1} is empty`);
    if (typeof v === 'number' && cell!.v !== v) fail(`row ${r + 2}, column ${c + 1} changed`);
    if (isDate(v) && inExcelRange(v.date) && Math.abs(((cell!.v as number) - 25569) * DAY - v.date) > 1000) fail(`the date in row ${r + 2} changed`);
    if (typeof v === 'string' && String(cell!.v) !== safeText(v)) fail(`row ${r + 2}, column ${c + 1} changed`);
  }));
}

export function buildCombinedCsv(result: CombineResult): string {
  const cell = (v: RawCell) => (isDate(v) ? dateText(v.date) : csvEscape(v));
  return `﻿${[result.headers.map(csvEscape).join(','), ...result.rows.map((r) => r.map(cell).join(','))].join('\r\n')}\r\n`;
}
