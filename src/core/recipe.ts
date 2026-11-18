// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { mean, median } from './stats';
import type { Cell, ColRole, ColType, Column, DataTable, Step } from './types';
import { parseDate, parseNumber } from './parse';

export const getColumn = (t: DataTable, name: string) => t.columns.find((c) => c.name === name);

export function cloneTable(t: DataTable): DataTable {
  return { ...t, columns: t.columns.map((c) => ({ ...c })), rowIds: t.rowIds };
}

function pick(t: DataTable, keep: number[]): DataTable {
  return {
    ...t,
    rowCount: keep.length,
    rowIds: keep.map((i) => t.rowIds[i]),
    columns: t.columns.map((c) => ({ ...c, values: keep.map((i) => c.values[i]) })),
  };
}

export function convertCell(v: Cell, to: ColType): Cell {
  if (v === null) return null;
  switch (to) {
    case 'number':
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return parseNumber(String(v))?.value ?? null;
    case 'date':
      if (typeof v === 'number') return v;
      return parseDate(String(v));
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      return ({ true: true, yes: true, y: true, '1': true, false: false, no: false, n: false, '0': false } as Record<string, boolean>)[String(v).trim().toLowerCase()] ?? null;
    default:
      return typeof v === 'string' ? v : String(v);
  }
}

const roleForType = (type: ColType, prev: ColRole): ColRole =>
  type === 'date' ? 'date' : type === 'number' ? (prev === 'ratio' || prev === 'id' ? prev : 'measure') : type === 'text' ? 'text' : 'dimension';

function setCol(t: DataTable, name: string, patch: Partial<Column>): DataTable {
  return { ...t, columns: t.columns.map((c) => (c.name === name ? { ...c, ...patch } : c)) };
}

function modeOf(values: Cell[]): Cell {
  const counts = new Map<Cell, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: Cell = null;
  let n = 0;
  counts.forEach((c, v) => { if (c > n) { n = c; best = v; } });
  return best;
}

const cellText = (c: Column, v: Cell) => (v === null ? '' : c.type === 'date' ? new Date(v as number).toISOString().slice(0, 10) : String(v));

/** Applies one step. Steps naming a missing column are skipped so recipes survive file changes. */
export function applyStep(t: DataTable, s: Step): DataTable {
  switch (s.op) {
    case 'setType': {
      const c = getColumn(t, s.col);
      if (!c || c.type === s.type) return t;
      return setCol(t, s.col, {
        type: s.type, role: roleForType(s.type, c.role), values: c.values.map((v) => convertCell(v, s.type)),
        format: s.type === 'number' ? c.format ?? 'number' : undefined,
      });
    }
    case 'setRole': return getColumn(t, s.col) ? setCol(t, s.col, { role: s.role }) : t;
    case 'rename':
      if (!getColumn(t, s.col) || !s.name.trim() || getColumn(t, s.name.trim())) return t;
      return setCol(t, s.col, { name: s.name.trim() });
    case 'drop': return { ...t, columns: t.columns.filter((c) => c.name !== s.col) };
    case 'fill': {
      const c = getColumn(t, s.col);
      if (!c) return t;
      const present = c.values.filter((v) => v !== null);
      const nums = present.filter((v): v is number => typeof v === 'number');
      if (s.strategy === 'forward') {
        let last: Cell = null;
        return setCol(t, s.col, { values: c.values.map((v) => (v === null ? last : (last = v))) });
      }
      const fill: Cell = s.strategy === 'zero' ? 0 : s.strategy === 'mean' ? mean(nums) : s.strategy === 'median' ? median(nums)
        : s.strategy === 'mode' ? modeOf(c.values) : s.value ?? null;
      if (typeof fill === 'number' && !Number.isFinite(fill)) return t;
      return setCol(t, s.col, { values: c.values.map((v) => v ?? fill) });
    }
    case 'dropMissing': {
      const c = getColumn(t, s.col);
      if (!c) return t;
      const keep: number[] = [];
      c.values.forEach((v, i) => { if (v !== null) keep.push(i); });
      return pick(t, keep);
    }
    case 'merge': {
      const cols = s.cols.map((n) => getColumn(t, n)).filter(Boolean) as Column[];
      if (cols.length < 2 || !s.name.trim() || (getColumn(t, s.name.trim()) && !s.cols.includes(s.name.trim()))) return t;
      const values: Cell[] = Array.from({ length: t.rowCount }, (_, i) => {
        const parts = cols.map((c) => cellText(c, c.values[i])).filter(Boolean);
        return parts.length ? parts.join(s.sep) : null;
      });
      const distinct = new Set(values).size;
      const merged: Column = { name: s.name.trim(), type: distinct <= 200 ? 'category' : 'text', role: distinct <= 200 ? 'dimension' : 'text', values };
      const at = t.columns.indexOf(cols[0]);
      const rest = t.columns.filter((c) => s.keep ? c.name !== merged.name : !s.cols.includes(c.name));
      const out = [...rest];
      out.splice(Math.min(at, out.length), 0, merged);
      return { ...t, columns: out };
    }
    case 'split': {
      const c = getColumn(t, s.col);
      if (!c || !s.sep) return t;
      const parts = c.values.map((v) => (v === null ? [] : String(v).split(s.sep).map((p) => p.trim())));
      const n = Math.min(12, parts.reduce((m, p) => Math.max(m, p.length), 0));
      const cols: Column[] = Array.from({ length: n }, (_, k) => {
        const values = parts.map((p) => (p[k] === undefined || p[k] === '' ? null : p[k]));
        return { name: s.names[k] || `${c.name} ${k + 1}`, type: 'category', role: 'dimension', values } as Column;
      });
      const at = t.columns.indexOf(c);
      const out = t.columns.filter((x) => x !== c);
      out.splice(at, 0, ...cols);
      return { ...t, columns: out };
    }
    case 'dedupe': {
      const seen = new Set<string>();
      const keep: number[] = [];
      for (let i = 0; i < t.rowCount; i++) {
        const k = JSON.stringify(t.columns.map((c) => c.values[i]));
        if (!seen.has(k)) { seen.add(k); keep.push(i); }
      }
      return pick(t, keep);
    }
    case 'replace': {
      const c = getColumn(t, s.col);
      return c ? setCol(t, s.col, { values: c.values.map((v) => (v === s.from ? s.to : v)) }) : t;
    }
    case 'excludeRows': {
      const drop = new Set(s.rows);
      const keep: number[] = [];
      t.rowIds.forEach((id, i) => { if (!drop.has(id)) keep.push(i); });
      return pick(t, keep);
    }
    case 'setCells': {
      const c = getColumn(t, s.col);
      if (!c) return t;
      const map = new Map(s.changes.map((x) => [x.row, x.value]));
      return setCol(t, s.col, { values: c.values.map((v, i) => (map.has(t.rowIds[i]) ? map.get(t.rowIds[i])! : v)) });
    }
  }
}

export const applyRecipe = (base: DataTable, steps: Step[]) => steps.reduce(applyStep, base);

/** Keeps the steps that make sense on a different file. Row-specific fixes are recomputed by the audit. */
export const reusableSteps = (steps: Step[]) => steps.filter((s) => s.op !== 'excludeRows' && s.op !== 'setCells');

export interface SchemaDiff { missing: string[]; added: string[]; typeChanged: string[]; }

export function diffSchema(prev: DataTable, next: DataTable): SchemaDiff {
  const names = new Set(next.columns.map((c) => c.name));
  const old = new Set(prev.columns.map((c) => c.name));
  return {
    missing: prev.columns.filter((c) => !names.has(c.name)).map((c) => c.name),
    added: next.columns.filter((c) => !old.has(c.name)).map((c) => c.name),
    typeChanged: prev.columns.filter((c) => { const n = getColumn(next, c.name); return n && n.type !== c.type; }).map((c) => c.name),
  };
}

/** Stacks tables, lining columns up by name. */
export function appendTables(tables: DataTable[], name: string): DataTable {
  const names: string[] = [];
  tables.forEach((t) => t.columns.forEach((c) => { if (!names.includes(c.name)) names.push(c.name); }));
  const rowCount = tables.reduce((s, t) => s + t.rowCount, 0);
  const columns = names.map((n) => {
    const first = tables.map((t) => getColumn(t, n)).find(Boolean)!;
    const values: Cell[] = [];
    for (const t of tables) {
      const c = getColumn(t, n);
      for (let i = 0; i < t.rowCount; i++) values.push(c ? (c.type === first.type ? c.values[i] : convertCell(c.values[i], first.type)) : null);
    }
    return { ...first, values };
  });
  return { name, columns, rowCount, rowIds: Array.from({ length: rowCount }, (_, i) => i) };
}

/** Left join. When the right key repeats, the first match is used so left totals are never inflated. */
export function joinTables(left: DataTable, right: DataTable, leftKey: string, rightKey: string): { table: DataTable; matched: number; repeatedKeys: number } {
  const lk = getColumn(left, leftKey);
  const rk = getColumn(right, rightKey);
  if (!lk || !rk) return { table: left, matched: 0, repeatedKeys: 0 };
  const norm = (v: Cell) => (v === null ? null : String(v).trim().toLowerCase());
  const index = new Map<string, number>();
  let repeatedKeys = 0;
  rk.values.forEach((v, i) => {
    const k = norm(v);
    if (k === null) return;
    if (index.has(k)) repeatedKeys++; else index.set(k, i);
  });
  const match = lk.values.map((v) => { const k = norm(v); return k === null ? undefined : index.get(k); });
  const taken = new Set(left.columns.map((c) => c.name));
  const added = right.columns.filter((c) => c !== rk).map((c) => {
    let n = c.name;
    let k = 2;
    while (taken.has(n)) n = `${c.name} (${right.name} ${k++})`;
    taken.add(n);
    return { ...c, name: n, values: match.map((m) => (m === undefined ? null : c.values[m])) };
  });
  return { table: { ...left, columns: [...left.columns, ...added] }, matched: match.filter((m) => m !== undefined).length, repeatedKeys };
}
