// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { RawCell, RawTable } from './types';

/**
 * Combines files row by row, lining columns up by header.
 * No column is ever dropped: a column found in only one file is kept, and is blank for the others.
 */

export interface CombineSource { name: string; headers: string[]; rows: RawCell[][] }

export interface CombineColumn {
  name: string;
  /** Position of this column in each source, or null when that source does not have it. */
  map: (number | null)[];
  /** True when the headers differ enough that a person should confirm they are the same question. */
  similar: boolean;
}

export interface CombineOptions { addSource: boolean; sourceHeader: string; removeDuplicates: boolean }

export interface CombineResult {
  headers: string[];
  rows: RawCell[][];
  rowsPerSource: number[];
  duplicatesRemoved: number;
}

const headerKey = (h: string) => h.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const FILLER = new Set(['for', 'the', 'of', 'a', 'an', 'tool', 'tools', 'form', 'field']);
const meaningful = (key: string) => key.split(' ').filter((w) => w && !FILLER.has(w)).sort().join(' ');
const digits = (key: string) => key.replace(/\D+/g, ' ').trim();

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Same words apart from filler, or a small spelling difference. Numbers must always agree. */
export function headersLookAlike(a: string, b: string): boolean {
  const [x, y] = [headerKey(a), headerKey(b)];
  if (!x || !y || digits(x) !== digits(y)) return false;
  if (meaningful(x) && meaningful(x) === meaningful(y)) return true;
  const longest = Math.max(x.length, y.length);
  return longest >= 8 && 1 - editDistance(x, y) / longest >= 0.93;
}

export function matchColumns(sources: CombineSource[]): CombineColumn[] {
  const count = sources.length;
  const blank = () => new Array<number | null>(count).fill(null);
  const columns: CombineColumn[] = (sources[0]?.headers ?? []).map((name, i) => {
    const map = blank();
    map[0] = i;
    return { name, map, similar: false };
  });

  for (let s = 1; s < count; s++) {
    const headers = sources[s].headers;
    const assigned = new Map<number, CombineColumn>();
    const free = () => columns.filter((c) => c.map[s] === null);
    const take = (i: number, c: CombineColumn, similar: boolean) => { c.map[s] = i; c.similar ||= similar; assigned.set(i, c); };
    headers.forEach((h, i) => { const c = free().find((x) => x.name === h); if (c) take(i, c, false); });
    headers.forEach((h, i) => { if (assigned.has(i)) return; const c = free().find((x) => headerKey(x.name) === headerKey(h)); if (c) take(i, c, false); });
    headers.forEach((h, i) => { if (assigned.has(i)) return; const c = free().find((x) => headersLookAlike(x.name, h)); if (c) take(i, c, true); });
    // New columns stay next to their neighbors, so the form's order is kept.
    let at = -1;
    headers.forEach((h, i) => {
      const hit = assigned.get(i);
      if (hit) { at = columns.indexOf(hit); return; }
      const map = blank();
      map[s] = i;
      columns.splice(at + 1, 0, { name: h, map, similar: false });
      at += 1;
    });
  }
  return columns;
}

/** Undoes a suggested match. Each file's column becomes its own column. */
export function separateColumn(columns: CombineColumn[], index: number, sources: CombineSource[]): CombineColumn[] {
  const c = columns[index];
  const parts = c.map.flatMap((pos, s) => {
    if (pos === null) return [];
    const map = new Array<number | null>(c.map.length).fill(null);
    map[s] = pos;
    return [{ name: sources[s].headers[pos], map, similar: false }];
  });
  return [...columns.slice(0, index), ...parts, ...columns.slice(index + 1)];
}

export const canMerge = (a: CombineColumn, b: CombineColumn) => a !== b && a.map.every((p, s) => p === null || b.map[s] === null);

/** Joins two columns that hold the same information under different headers. */
export function mergeColumns(columns: CombineColumn[], keep: number, other: number): CombineColumn[] {
  const [a, b] = [columns[keep], columns[other]];
  if (!canMerge(a, b)) return columns;
  const merged = { ...a, map: a.map.map((p, s) => p ?? b.map[s]), similar: false };
  return columns.flatMap((c, i) => (i === keep ? [merged] : i === other ? [] : [c]));
}

/** Keeps each header exactly as written, adding a number only when two would be identical. */
function distinctHeaders(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n, i) => {
    const base = n.trim() || `Column ${i + 1}`;
    const key = base.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count > 1 ? `${base} (${count})` : base;
  });
}

const isBlank = (v: RawCell | undefined) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const rowKey = (r: RawCell[]) => JSON.stringify(r.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v ?? null)));

export function combineSources(sources: CombineSource[], columns: CombineColumn[], opts: CombineOptions): CombineResult {
  const names = distinctHeaders([...(opts.addSource ? [opts.sourceHeader.trim() || 'Source File'] : []), ...columns.map((c) => c.name)]);
  const seen = new Set<string>();
  const rows: RawCell[][] = [];
  const rowsPerSource: number[] = [];
  let duplicatesRemoved = 0;
  sources.forEach((src, s) => {
    let kept = 0;
    for (const raw of src.rows) {
      const cells = columns.map((c) => { const p = c.map[s]; const v = p === null ? null : raw[p] ?? null; return isBlank(v) ? null : v; });
      if (opts.removeDuplicates) {
        const k = rowKey(cells);
        if (seen.has(k)) { duplicatesRemoved++; continue; }
        seen.add(k);
      }
      rows.push(opts.addSource ? [src.name, ...cells] : cells);
      kept++;
    }
    rowsPerSource.push(kept);
  });
  return { headers: names, rows, rowsPerSource, duplicatesRemoved };
}

/** Proves that every filled cell from every file arrived in the combined table. */
export function checkCombined(sources: CombineSource[], columns: CombineColumn[], result: CombineResult, opts: CombineOptions): string | null {
  const offset = opts.addSource ? 1 : 0;
  const total = sources.reduce((n, s) => n + s.rows.length, 0);
  if (result.rows.length + result.duplicatesRemoved !== total) return 'The row count does not match the files.';
  if (opts.removeDuplicates) return null;
  for (let c = 0; c < columns.length; c++) {
    let expected = 0;
    sources.forEach((src, s) => { const p = columns[c].map[s]; if (p !== null) src.rows.forEach((r) => { if (!isBlank(r[p])) expected++; }); });
    const actual = result.rows.reduce((n, r) => n + (isBlank(r[c + offset]) ? 0 : 1), 0);
    if (expected !== actual) return `Values are missing from ${columns[c].name}.`;
  }
  for (let s = 0; s < sources.length; s++) {
    const used = new Set(columns.map((c) => c.map[s]));
    const lost = sources[s].headers.findIndex((_, i) => !used.has(i));
    if (lost >= 0) return `${sources[s].headers[lost]} from ${sources[s].name} was left out.`;
  }
  return null;
}

export const toRawTable = (r: CombineResult, name: string): RawTable => ({ name, source: name, headers: r.headers, rows: r.rows });

/**
 * Source `table` has no row that is not also in source `within`. `same` means the two hold exactly the same rows.
 * `byStamp` names the date-time column that matched the rows when some of their other cells were edited.
 */
export interface Overlap { table: number; within: number; same: boolean; byStamp?: string }

/** 53-bit string hash (cyrb53). Two different rows sharing a hash is vanishingly unlikely. */
function hash(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const cellKey = (v: RawCell | undefined) => (v === null || v === undefined ? '' : typeof v === 'string' ? v.trim().toLowerCase() : typeof v === 'object' ? `d${v.date}` : `${typeof v}${v}`);

/** Date-time columns that tell rows apart, such as the Timestamp of form responses: at least 99% distinct and almost never blank. */
function stampColumns(s: CombineSource): number[] {
  const out: { c: number; ratio: number }[] = [];
  s.headers.forEach((_, c) => {
    const seen = new Set<number>();
    let n = 0;
    for (const r of s.rows) { const v = r[c]; if (v && typeof v === 'object' && v.date % 86400000 !== 0) { n++; seen.add(v.date); } }
    if (n >= s.rows.length * 0.95 && seen.size >= s.rows.length * 0.99) out.push({ c, ratio: seen.size / s.rows.length });
  });
  return out.sort((a, b) => b.ratio - a.ratio || a.c - b.c).map((x) => x.c);
}

/**
 * Finds sources whose rows already appear in another source with the same headers: the same file added twice,
 * or a master sheet next to the monthly sheets it was built from. Stacking those would count every row twice.
 * A copy whose cells were edited afterwards is still found when its rows carry the same unique Timestamps.
 */
export function findOverlaps(sources: CombineSource[]): Overlap[] {
  const shape = (s: CombineSource) => s.headers.map(headerKey).sort().join('\u0001');
  const fingerprints = new Map<number, Map<number, number>>();
  const prints = (i: number) => {
    let m = fingerprints.get(i);
    if (m) return m;
    const s = sources[i];
    const order = s.headers.map((h, c) => ({ h: headerKey(h), c })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.c - b.c)).map((x) => x.c);
    m = new Map();
    for (const r of s.rows) { const k = hash(order.map((c) => cellKey(r[c])).join('\u0001')); m.set(k, (m.get(k) ?? 0) + 1); }
    fingerprints.set(i, m);
    return m;
  };
  const stamps = new Map<number, number[]>();
  const stampsOf = (i: number) => { let s = stamps.get(i); if (!s) { s = stampColumns(sources[i]); stamps.set(i, s); } return s; };
  /** The header of a Timestamp column under which at least 98% of the smaller source's rows are found in the larger one. */
  const sameStamps = (big: number, small: number): string | null => {
    for (const c of stampsOf(small)) {
      const key = headerKey(sources[small].headers[c]);
      const at = sources[big].headers.findIndex((h) => headerKey(h) === key);
      if (at < 0) continue;
      const have = new Set<number>();
      for (const r of sources[big].rows) { const v = r[at]; if (v && typeof v === 'object') have.add(v.date); }
      let hits = 0;
      for (const r of sources[small].rows) { const v = r[c]; if (v && typeof v === 'object' && have.has(v.date)) hits++; }
      if (hits >= sources[small].rows.length * 0.98) return sources[small].headers[c];
    }
    return null;
  };
  const out: Overlap[] = [];
  const bySize = sources.map((_, i) => i).filter((i) => sources[i].rows.length > 0).sort((a, b) => sources[b].rows.length - sources[a].rows.length || a - b);
  const flagged = new Set<number>();
  for (const i of bySize) {
    if (flagged.has(i)) continue;
    for (const j of bySize) {
      if (j === i || flagged.has(j) || sources[j].rows.length > sources[i].rows.length || shape(sources[i]) !== shape(sources[j])) continue;
      if (sources[j].rows.length === sources[i].rows.length && j < i) continue;
      const big = prints(i);
      let inside = true;
      for (const [k, n] of prints(j)) if ((big.get(k) ?? 0) < n) { inside = false; break; }
      if (inside) { out.push({ table: j, within: i, same: sources[j].rows.length === sources[i].rows.length }); flagged.add(j); continue; }
      const byStamp = sameStamps(i, j);
      if (byStamp) { out.push({ table: j, within: i, same: false, byStamp }); flagged.add(j); }
    }
  }
  return out;
}
