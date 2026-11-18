// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ColumnHint, RawCell, RawTable } from '../core/types';
import { gridToTables } from './grid';

const ERROR_CODES: Record<number, string> = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A' };

/* ---------- Excel ---------- */

export function readWorkbook(buf: ArrayBuffer | Uint8Array, source: string): RawTable[] {
  const wb = XLSX.read(buf, { type: 'array', cellNF: true, cellDates: false, cellFormula: false, dense: false });
  const epoch = wb.Workbook?.WBProps?.date1904 ? 24107 : 25569;
  const out: RawTable[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    const grid: RawCell[][] = Array.from({ length: rows }, () => new Array<RawCell>(cols).fill(null));
    const hintVotes: Map<string, number>[] = Array.from({ length: cols }, () => new Map());
    const currencyVotes: (string | undefined)[] = new Array(cols).fill(undefined);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: r + range.s.r, c: c + range.s.c })] as XLSX.CellObject | undefined;
        if (!cell || cell.v === undefined || cell.v === null) continue;
        if (cell.t === 'n') {
          const z = typeof cell.z === 'string' ? cell.z : '';
          if (z && XLSX.SSF.is_date(z)) grid[r][c] = { date: Math.round(((cell.v as number) - epoch) * 86400000) };
          else {
            grid[r][c] = cell.v as number;
            if (z.includes('%')) hintVotes[c].set('percent', (hintVotes[c].get('percent') ?? 0) + 1);
            const cur = z.match(/\[\$([^\]-]+)|([$€£¥₱₹])/);
            if (cur) { hintVotes[c].set('currency', (hintVotes[c].get('currency') ?? 0) + 1); currencyVotes[c] = cur[1] ?? cur[2]; }
          }
        } else if (cell.t === 'b') grid[r][c] = Boolean(cell.v);
        else if (cell.t === 'e') grid[r][c] = ERROR_CODES[cell.v as number] ?? '#VALUE!';
        else grid[r][c] = String(cell.v);
      }
    }
    // Merged cells: repeat the value so grouped labels are not lost.
    for (const m of sheet['!merges'] ?? []) {
      const v = grid[m.s.r - range.s.r]?.[m.s.c - range.s.c];
      if (v === undefined || v === null) continue;
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) {
        if (grid[r - range.s.r]) grid[r - range.s.r][c - range.s.c] = v;
      }
    }
    const hints: (ColumnHint | undefined)[] = hintVotes.map((v, i) =>
      v.get('percent') ? { format: 'percent' } : v.get('currency') ? { format: 'currency', currency: currencyVotes[i] } : undefined);
    out.push(...gridToTables(grid, sheetName, source, hints));
  }
  return out;
}

/* ---------- CSV ---------- */

export function decodeText(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Picks the separator that splits the most lines into the same number of columns. */
export function detectDelimiter(text: string): string {
  let best = ',';
  let bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const rows = Papa.parse<string[]>(text.slice(0, 200000), { delimiter: d, preview: 200, skipEmptyLines: true }).data;
    const counts = new Map<number, number>();
    rows.forEach((r) => counts.set(r.length, (counts.get(r.length) ?? 0) + 1));
    const [width, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [1, 0];
    const score = width > 1 ? (hits / Math.max(1, rows.length)) * 1000 + width : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function readCsv(text: string, source: string): RawTable[] {
  const res = Papa.parse<string[]>(text, { delimiter: detectDelimiter(text), skipEmptyLines: false });
  const name = source.replace(/\.[^.]+$/, '');
  return gridToTables(res.data as RawCell[][], name, source);
}

/* ---------- JSON ---------- */

function flatten(obj: unknown, prefix: string, out: Record<string, RawCell>) {
  if (obj === null || obj === undefined) { if (prefix) out[prefix] = null; return; }
  if (Array.isArray(obj)) {
    out[prefix] = obj.every((v) => typeof v !== 'object' || v === null) ? obj.join(', ') : `${obj.length} items`;
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out[prefix] = obj as RawCell;
}

function recordsToTable(records: unknown[], name: string, source: string): RawTable | null {
  const flat = records.filter((r) => typeof r === 'object' && r !== null && !Array.isArray(r)).map((r) => {
    const o: Record<string, RawCell> = {};
    flatten(r, '', o);
    return o;
  });
  if (!flat.length) return null;
  const headers: string[] = [];
  const seen = new Set<string>();
  flat.forEach((r) => Object.keys(r).forEach((k) => { if (!seen.has(k)) { seen.add(k); headers.push(k); } }));
  return { name, source, headers, rows: flat.map((r) => headers.map((h) => r[h] ?? null)) };
}

export function readJson(text: string, source: string): RawTable[] {
  const name = source.replace(/\.[^.]+$/, '');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Newline-delimited JSON
    data = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
  if (Array.isArray(data)) {
    if (data.length && Array.isArray(data[0])) {
      return gridToTables(data as RawCell[][], name, source);
    }
    const t = recordsToTable(data, name, source);
    return t ? [t] : [];
  }
  const out: RawTable[] = [];
  const visit = (o: Record<string, unknown>, path: string) => {
    for (const [k, v] of Object.entries(o)) {
      const label = path ? `${path}.${k}` : k;
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
        const t = recordsToTable(v, label, source);
        if (t) out.push(t);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) visit(v as Record<string, unknown>, label);
    }
  };
  if (data && typeof data === 'object') visit(data as Record<string, unknown>, '');
  if (!out.length && data && typeof data === 'object') {
    const t = recordsToTable([data], name, source);
    if (t) out.push(t);
  }
  return out;
}
