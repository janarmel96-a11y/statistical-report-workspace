// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type ExcelJSNS from 'exceljs';
import * as XLSX from 'xlsx';
import type { CombineColumn, CombineResult, CombineSource } from '../core/combine';
import type { RawCell } from '../core/types';
import { csvEscape, safeSheetName, safeText } from './workbook';

const DAY = 86400000;
const isDate = (v: RawCell): v is { date: number } => typeof v === 'object' && v !== null;
const inExcelRange = (ms: number) => ms >= Date.UTC(1900, 2, 1) && ms <= Date.UTC(9999, 11, 31);
const dateText = (ms: number) => { const iso = new Date(ms).toISOString(); return ms % DAY === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' '); };

/** Writes the combined table. Dates stay dates, numbers stay numbers, and long IDs are never shortened. */
export async function buildCombinedWorkbook(sources: CombineSource[], columns: CombineColumn[], result: CombineResult): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const ExcelJS = (mod.default ?? mod) as typeof ExcelJSNS;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Statistical Report Workspace';
  const used = new Set<string>();
  const ws = wb.addWorksheet(safeSheetName('Combined', used), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = result.headers.map(() => ({ width: 20 }));
  const head = ws.getRow(1);
  result.headers.forEach((h, i) => { head.getCell(i + 1).value = safeText(h); });
  head.font = { bold: true };
  head.alignment = { vertical: 'top', wrapText: true };
  head.height = 48;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } }; });
  result.rows.forEach((row) => {
    const out = ws.addRow(row.map((v) => {
      if (isDate(v)) return inExcelRange(v.date) ? new Date(v.date) : dateText(v.date);
      if (typeof v === 'string') return safeText(v);
      return typeof v === 'number' && !Number.isFinite(v) ? null : v;
    }));
    row.forEach((v, i) => {
      if (isDate(v) && inExcelRange(v.date)) out.getCell(i + 1).numFmt = v.date % DAY === 0 ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm:ss';
      else if (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 100000) out.getCell(i + 1).numFmt = '0';
    });
  });
  if (result.headers.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, result.rows.length + 1), column: result.headers.length } };

  const info = wb.addWorksheet(safeSheetName('Combine Summary', used));
  info.columns = [{ width: 58 }, { width: 14 }, { width: 14 }];
  info.addRow(['File', 'Rows', 'Columns']).font = { bold: true };
  sources.forEach((s, i) => info.addRow([safeText(s.name), result.rowsPerSource[i], s.headers.length]));
  info.addRow(['Combined total', result.rows.length, result.headers.length]).font = { bold: true };
  if (result.duplicatesRemoved) info.addRow(['Exact duplicate rows removed', result.duplicatesRemoved]);
  const partial = columns.filter((c) => c.map.some((p) => p === null));
  if (partial.length) {
    info.addRow([]);
    info.addRow(['Columns not found in every file', 'Found in']).font = { bold: true };
    partial.forEach((c) => info.addRow([safeText(c.name), c.map.flatMap((p, i) => (p === null ? [] : [safeText(sources[i].name)])).join('; ')]));
  }
  return (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}

/** Reopens the finished workbook and compares every cell with the combined table. */
export function verifyCombinedWorkbook(buf: ArrayBuffer, result: CombineResult): void {
  const fail = (m: string): never => { throw new Error(`The combined file failed its safety check: ${m}`); };
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const ws = wb.Sheets.Combined ?? fail('the combined sheet is missing');
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  if (range.e.r !== result.rows.length) fail('the row count changed');
  if (range.e.c + 1 !== result.headers.length) fail('the column count changed');
  result.rows.forEach((row, r) => row.forEach((v, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r: r + 1, c })] as XLSX.CellObject | undefined;
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
