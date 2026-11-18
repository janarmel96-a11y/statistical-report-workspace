// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { ColumnHint, RawCell, RawTable } from '../core/types';

const isBlank = (v: RawCell) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const looksLikeHeaderCell = (v: RawCell) => typeof v === 'string' && !isBlank(v) && !/^[-+(]?[$€£¥₱₹]?\d[\d,.]*%?\)?$/.test(v.trim());

function headerIndex(rows: RawCell[][], width: number): number {
  const limit = Math.min(rows.length, 12);
  for (let i = 0; i < limit; i++) {
    const filled = rows[i].filter((v) => !isBlank(v)).length;
    const labels = rows[i].filter(looksLikeHeaderCell).length;
    if (filled >= Math.max(2, Math.ceil(width * 0.6)) && labels / filled >= 0.7) return i;
  }
  for (let i = 0; i < limit; i++) if (rows[i].filter((v) => !isBlank(v)).length >= Math.max(2, Math.ceil(width * 0.6))) return i;
  return 0;
}

/**
 * Finds the tables in a sheet: separates blocks on blank rows, skips report titles above the header,
 * and rejoins a block that a stray blank row split away from its table.
 */
export function gridToTables(grid: RawCell[][], name: string, source: string, hints?: (ColumnHint | undefined)[]): RawTable[] {
  const blocks: { start: number; rows: RawCell[][] }[] = [];
  let cur: RawCell[][] = [];
  let start = 0;
  grid.forEach((r, i) => {
    if (r.every(isBlank)) {
      if (cur.length) blocks.push({ start, rows: cur });
      cur = [];
    } else {
      if (!cur.length) start = i;
      cur.push(r);
    }
  });
  if (cur.length) blocks.push({ start, rows: cur });

  const widthOf = (rows: RawCell[][]) => rows.reduce((w, r) => Math.max(w, r.reduce<number>((m, v, i) => (isBlank(v) ? m : i + 1), 0)), 0);
  const merged: typeof blocks = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    const titleOnly = b.rows.every((r) => r.filter((v) => !isBlank(v)).length <= 1);
    if (titleOnly && !prev) continue;
    if (titleOnly && b.rows.length <= 2) continue;
    const headerLike = b.rows[0].filter(looksLikeHeaderCell).length / Math.max(1, b.rows[0].filter((v) => !isBlank(v)).length) >= 0.8 && b.rows.length > 1;
    if (prev && !headerLike && Math.abs(widthOf(b.rows) - widthOf(prev.rows)) <= 1) { for (const r of b.rows) prev.rows.push(r); }
    else merged.push({ start: b.start, rows: b.rows });
  }

  const out: RawTable[] = [];
  merged.forEach((b, n) => {
    const width = widthOf(b.rows);
    if (width < 1 || b.rows.length < 2) return;
    const h = headerIndex(b.rows, width);
    const headers = Array.from({ length: width }, (_, i) => {
      const v = b.rows[h][i];
      return isBlank(v) ? '' : typeof v === 'object' && v !== null ? new Date(v.date).toISOString().slice(0, 10) : String(v);
    });
    const rows = b.rows.slice(h + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null));
    if (!rows.length) return;
    // Drop columns that have neither a header nor any data.
    const keep = headers.map((hd, i) => hd.trim() !== '' || rows.some((r) => !isBlank(r[i])));
    out.push({
      name: merged.length > 1 ? `${name} (table ${n + 1})` : name,
      source,
      headers: headers.filter((_, i) => keep[i]),
      rows: rows.map((r) => r.filter((_, i) => keep[i])),
      hints: hints?.slice(0, width).filter((_, i) => keep[i]),
    });
  });
  return out;
}
