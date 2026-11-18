import type { Engine } from './engine';
import { bucketAdd, bucketStart, groupConstraint, PART_ORDER, shiftYears } from './engine';
import { mean, median, quantile, stdev, sum, variance } from './stats';
import type { Cell, Constraint, DatePart } from './types';

/** A small DAX-style formula language: tokenizer, parser, validator, evaluator. */

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; name: string; pos: number }
  | { t: 'call'; name: string; args: Node[]; pos: number }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'un'; op: string; e: Node };

export class MeasureError extends Error {
  constructor(message: string, public pos = 0) { super(message); }
}

type Tok = { k: 'num' | 'str' | 'ref' | 'id' | 'op' | 'end'; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const pos = i;
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/);
      if (!m) throw new MeasureError(`Unexpected "${c}"`, i);
      out.push({ k: 'num', v: m[0], pos }); i += m[0].length; continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      if (j >= src.length) throw new MeasureError('Text is missing its closing quote', i);
      out.push({ k: 'str', v: s, pos }); i = j + 1; continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new MeasureError('Field name is missing its closing ]', i);
      out.push({ k: 'ref', v: src.slice(i + 1, j).trim(), pos }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/)!;
      out.push({ k: 'id', v: m[0].toUpperCase(), pos }); i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two, pos }); i += 2; continue; }
    if ('+-*/^=<>(),&'.includes(c)) { out.push({ k: 'op', v: c, pos }); i++; continue; }
    throw new MeasureError(`Unexpected character "${c}"`, i);
  }
  out.push({ k: 'end', v: '', pos: src.length });
  return out;
}

export function parseMeasure(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => peek().k === 'op' && ops.includes(peek().v);
  const isWord = (w: string) => peek().k === 'id' && peek().v === w;

  const orExpr = (): Node => { let l = andExpr(); while (isOp('||') || isWord('OR')) { p++; l = { t: 'bin', op: '||', l, r: andExpr() }; } return l; };
  const andExpr = (): Node => { let l = cmp(); while (isOp('&&') || isWord('AND')) { p++; l = { t: 'bin', op: '&&', l, r: cmp() }; } return l; };
  const cmp = (): Node => {
    let l = concat();
    while (isOp('=', '<>', '!=', '<', '<=', '>', '>=')) { const op = toks[p++].v; l = { t: 'bin', op: op === '!=' ? '<>' : op, l, r: concat() }; }
    return l;
  };
  const concat = (): Node => { let l = add(); while (isOp('&')) { p++; l = { t: 'bin', op: '&', l, r: add() }; } return l; };
  const add = (): Node => { let l = mul(); while (isOp('+', '-')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: mul() }; } return l; };
  const mul = (): Node => { let l = unary(); while (isOp('*', '/')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: unary() }; } return l; };
  const unary = (): Node => { if (isOp('-', '+')) { const op = toks[p++].v; return { t: 'un', op, e: unary() }; } return pow(); };
  const pow = (): Node => { const l = atom(); if (isOp('^')) { p++; return { t: 'bin', op: '^', l, r: unary() }; } return l; };
  const atom = (): Node => {
    const tk = toks[p++];
    if (tk.k === 'num') return { t: 'num', v: Number(tk.v) };
    if (tk.k === 'str') return { t: 'str', v: tk.v };
    if (tk.k === 'ref') return { t: 'ref', name: tk.v, pos: tk.pos };
    if (tk.k === 'id') {
      if (tk.v === 'TRUE' || tk.v === 'FALSE') { if (isOp('(')) { p++; p++; } return { t: 'bool', v: tk.v === 'TRUE' }; }
      if (!isOp('(')) throw new MeasureError(`${tk.v} must be followed by (`, tk.pos);
      p++;
      const args: Node[] = [];
      if (!isOp(')')) { args.push(orExpr()); while (isOp(',')) { p++; args.push(orExpr()); } }
      if (!isOp(')')) throw new MeasureError('Missing closing )', peek().pos);
      p++;
      return { t: 'call', name: tk.v, args, pos: tk.pos };
    }
    if (tk.k === 'op' && tk.v === '(') {
      const e = orExpr();
      if (!isOp(')')) throw new MeasureError('Missing closing )', peek().pos);
      p++;
      return e;
    }
    throw new MeasureError(tk.k === 'end' ? 'The formula ends too early' : `Unexpected "${tk.v}"`, tk.pos);
  };
  const out = orExpr();
  if (peek().k !== 'end') throw new MeasureError(`Unexpected "${peek().v}"`, peek().pos);
  return out;
}

/* ---------- function catalog ---------- */

export const FUNCTIONS: Record<string, { min: number; max: number; sig: string; doc: string; kind: 'agg' | 'scalar' | 'row' | 'time' | 'filter' }> = {
  SUM: { min: 1, max: 1, sig: 'SUM(expression)', doc: 'Adds values. Accepts row math such as SUM([Qty] * [Price]).', kind: 'agg' },
  AVERAGE: { min: 1, max: 1, sig: 'AVERAGE(expression)', doc: 'Arithmetic mean, ignoring blanks.', kind: 'agg' },
  MEDIAN: { min: 1, max: 1, sig: 'MEDIAN(expression)', doc: 'Middle value.', kind: 'agg' },
  MIN: { min: 1, max: 1, sig: 'MIN(expression)', doc: 'Smallest value.', kind: 'agg' },
  MAX: { min: 1, max: 1, sig: 'MAX(expression)', doc: 'Largest value.', kind: 'agg' },
  COUNT: { min: 1, max: 1, sig: 'COUNT([Column])', doc: 'Counts non-blank values.', kind: 'agg' },
  COUNTROWS: { min: 0, max: 0, sig: 'COUNTROWS()', doc: 'Counts rows in the current filter.', kind: 'agg' },
  DISTINCTCOUNT: { min: 1, max: 1, sig: 'DISTINCTCOUNT([Column])', doc: 'Counts unique values.', kind: 'agg' },
  STDEV: { min: 1, max: 1, sig: 'STDEV(expression)', doc: 'Sample standard deviation.', kind: 'agg' },
  VAR: { min: 1, max: 1, sig: 'VAR(expression)', doc: 'Sample variance.', kind: 'agg' },
  PERCENTILE: { min: 2, max: 2, sig: 'PERCENTILE(expression, 0.9)', doc: 'Value at a percentile between 0 and 1.', kind: 'agg' },
  SUMIF: { min: 2, max: 2, sig: 'SUMIF(expression, condition)', doc: 'Adds values on rows meeting the condition.', kind: 'agg' },
  AVERAGEIF: { min: 2, max: 2, sig: 'AVERAGEIF(expression, condition)', doc: 'Averages values on rows meeting the condition.', kind: 'agg' },
  COUNTIF: { min: 1, max: 1, sig: 'COUNTIF(condition)', doc: 'Counts rows meeting the condition.', kind: 'agg' },
  DIVIDE: { min: 2, max: 3, sig: 'DIVIDE(a, b, alternate)', doc: 'Safe division. Returns blank or the alternate when b is 0.', kind: 'scalar' },
  IF: { min: 2, max: 3, sig: 'IF(condition, then, else)', doc: 'Conditional value.', kind: 'scalar' },
  NOT: { min: 1, max: 1, sig: 'NOT(condition)', doc: 'Reverses a condition.', kind: 'scalar' },
  ABS: { min: 1, max: 1, sig: 'ABS(x)', doc: 'Absolute value.', kind: 'scalar' },
  ROUND: { min: 1, max: 2, sig: 'ROUND(x, digits)', doc: 'Rounds half away from zero.', kind: 'scalar' },
  ISBLANK: { min: 1, max: 1, sig: 'ISBLANK(x)', doc: 'True when x is blank.', kind: 'scalar' },
  BLANK: { min: 0, max: 0, sig: 'BLANK()', doc: 'A blank value.', kind: 'scalar' },
  COALESCE: { min: 2, max: 8, sig: 'COALESCE(a, b, ...)', doc: 'First non-blank value.', kind: 'scalar' },
  PARAM: { min: 1, max: 1, sig: 'PARAM("Name")', doc: 'Current value of a what-if parameter.', kind: 'scalar' },
  CALCULATE: { min: 1, max: 9, sig: 'CALCULATE(expression, filter, ...)', doc: 'Evaluates with changed filters.', kind: 'filter' },
  ALL: { min: 0, max: 8, sig: 'ALL([Column])', doc: 'Inside CALCULATE: removes filters from a column, or all filters.', kind: 'filter' },
  REMOVEFILTERS: { min: 0, max: 8, sig: 'REMOVEFILTERS([Column])', doc: 'Same as ALL.', kind: 'filter' },
  PCTOFTOTAL: { min: 1, max: 2, sig: 'PCTOFTOTAL(expression, [Column])', doc: 'Share of the visible total, or of the total across a column.', kind: 'filter' },
  RUNNINGSUM: { min: 1, max: 2, sig: 'RUNNINGSUM(expression, [Date])', doc: 'Cumulative total up to each period.', kind: 'time' },
  MOVINGAVG: { min: 3, max: 3, sig: 'MOVINGAVG(expression, [Date], periods)', doc: 'Average of the latest periods.', kind: 'time' },
  PREVIOUSYEAR: { min: 1, max: 2, sig: 'PREVIOUSYEAR(expression, [Date])', doc: 'Same period one year earlier.', kind: 'time' },
  PREVIOUSPERIOD: { min: 1, max: 2, sig: 'PREVIOUSPERIOD(expression, [Date])', doc: 'The period before this one.', kind: 'time' },
  YTD: { min: 1, max: 2, sig: 'YTD(expression, [Date])', doc: 'Year to date.', kind: 'time' },
};

const AGG_NAMES = new Set(Object.entries(FUNCTIONS).filter(([, f]) => f.kind === 'agg').map(([k]) => k));
const ALIASES: Record<string, string> = { AVG: 'AVERAGE', REMOVE: 'REMOVEFILTERS' };
const fnName = (n: string) => ALIASES[n] ?? n;

export interface ValidationResult { ok: boolean; error?: string; pos?: number }

/** Checks a formula against the table before it can be saved. */
export function validateMeasure(expr: string, columns: string[], measures: string[], self?: string, deps: Record<string, string> = {}): ValidationResult {
  try {
    if (!expr.trim()) return { ok: false, error: 'Enter a formula' };
    const root = parseMeasure(expr);
    const cols = new Set(columns.map((c) => c.toLowerCase()));
    const ms = new Set(measures.map((c) => c.toLowerCase()));
    const walk = (n: Node, inRow: boolean): void => {
      if (n.t === 'ref') {
        const k = n.name.toLowerCase();
        if (!cols.has(k) && !ms.has(k)) throw new MeasureError(`Unknown field [${n.name}]`, n.pos);
        if (cols.has(k) && !inRow) throw new MeasureError(`[${n.name}] must be inside a function such as SUM([${n.name}])`, n.pos);
        if (inRow && !cols.has(k)) throw new MeasureError(`Measure [${n.name}] cannot be used row by row`, n.pos);
      } else if (n.t === 'bin') { walk(n.l, inRow); walk(n.r, inRow); }
      else if (n.t === 'un') walk(n.e, inRow);
      else if (n.t === 'call') {
        const name = fnName(n.name);
        const f = FUNCTIONS[name];
        if (!f) throw new MeasureError(`Unknown function ${n.name}`, n.pos);
        if (n.args.length < f.min || n.args.length > f.max) throw new MeasureError(`Usage: ${f.sig}`, n.pos);
        if (inRow && (f.kind !== 'scalar')) throw new MeasureError(`${name} cannot be nested inside a row calculation`, n.pos);
        if (f.kind === 'agg') {
          const last = name === 'PERCENTILE' ? 1 : n.args.length;
          n.args.slice(0, last).forEach((a) => walk(a, true));
          if (name === 'PERCENTILE') walk(n.args[1], false);
        } else if (name === 'ALL' || name === 'REMOVEFILTERS') n.args.forEach((a) => walk(a, true));
        else if (name === 'CALCULATE') {
          walk(n.args[0], false);
          n.args.slice(1).forEach((a) => (a.t === 'call' && ['ALL', 'REMOVEFILTERS'].includes(fnName(a.name)) ? walk(a, false) : walk(a, true)));
        } else if (f.kind === 'time' || name === 'PCTOFTOTAL') {
          walk(n.args[0], false);
          if (n.args[1]) { if (n.args[1].t !== 'ref') throw new MeasureError(`Usage: ${f.sig}`, n.pos); walk(n.args[1], true); }
          if (name === 'MOVINGAVG' && n.args[2].t !== 'num') throw new MeasureError('The number of periods must be a number', n.pos);
        } else n.args.forEach((a) => walk(a, inRow));
      }
    };
    walk(root, false);
    if (self) {
      const seen = new Set<string>();
      const visit = (src: string) => {
        for (const m of src.matchAll(/\[([^\]]+)\]/g)) {
          const dep = m[1].trim().toLowerCase();
          if (dep === self.toLowerCase()) throw new MeasureError('A measure cannot depend on itself');
          const key = Object.keys(deps).find((k) => k.toLowerCase() === dep);
          if (key && !seen.has(key)) { seen.add(key); visit(deps[key]); }
        }
      };
      visit(expr);
    }
    return { ok: true };
  } catch (e) {
    const err = e as MeasureError;
    return { ok: false, error: err.message, pos: err.pos };
  }
}

/* ---------- evaluation ---------- */

const num = (v: Cell): number | null => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null);
const truthy = (v: Cell) => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v.length > 0 : false);

function compare(op: string, a: Cell, b: Cell): boolean {
  if (a === null || b === null) {
    if (op === '=') return a === b;
    if (op === '<>') return a !== b;
    return false;
  }
  const x = typeof a === 'string' ? a.toLowerCase() : a;
  const y = typeof b === 'string' ? b.toLowerCase() : b;
  switch (op) {
    case '=': return x === y;
    case '<>': return x !== y;
    case '<': return x < y;
    case '<=': return x <= y;
    case '>': return x > y;
    default: return x >= y;
  }
}

/** Blank handling follows DAX: blank acts as 0 in + and -, and stays blank in * and /. */
function binary(op: string, a: Cell, b: Cell): Cell {
  switch (op) {
    case '+': case '-': {
      if (a === null && b === null) return null;
      const x = num(a) ?? 0;
      const y = num(b) ?? 0;
      return op === '+' ? x + y : x - y;
    }
    case '*': { const [x, y] = [num(a), num(b)]; return x === null || y === null ? null : x * y; }
    case '/': { const [x, y] = [num(a), num(b)]; return x === null || y === null || y === 0 ? null : x / y; }
    case '^': { const [x, y] = [num(a), num(b)]; if (x === null || y === null) return null; const r = x ** y; return Number.isFinite(r) ? r : null; }
    case '&': return `${a ?? ''}${b ?? ''}`;
    case '&&': return truthy(a) && truthy(b);
    case '||': return truthy(a) || truthy(b);
    default: return compare(op, a, b);
  }
}

function roundHalfAway(x: number, d: number) {
  const f = 10 ** d;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
}

function scalarFn(name: string, a: Cell[]): Cell {
  switch (name) {
    case 'DIVIDE': { const [x, y] = [num(a[0]), num(a[1])]; return x === null || y === null || y === 0 ? a[2] ?? null : x / y; }
    case 'NOT': return !truthy(a[0]);
    case 'ABS': { const x = num(a[0]); return x === null ? null : Math.abs(x); }
    case 'ROUND': { const x = num(a[0]); return x === null ? null : roundHalfAway(x, num(a[1] ?? 0) ?? 0); }
    case 'ISBLANK': return a[0] === null;
    case 'BLANK': return null;
    case 'COALESCE': return a.find((v) => v !== null) ?? null;
    default: return null;
  }
}

type RowFn = (i: number) => Cell;
const rowCache = new WeakMap<Engine, WeakMap<Node, RowFn>>();

function rowFn(n: Node, en: Engine): RowFn {
  let cache = rowCache.get(en);
  if (!cache) { cache = new WeakMap(); rowCache.set(en, cache); }
  const hit = cache.get(n);
  if (hit) return hit;
  let f: RowFn;
  switch (n.t) {
    case 'num': case 'str': case 'bool': { const v = n.v; f = () => v; break; }
    case 'ref': { const vals = resolveColumn(en, n.name)?.values ?? []; f = (i) => vals[i] ?? null; break; }
    case 'un': { const e = rowFn(n.e, en); f = n.op === '-' ? (i) => { const v = num(e(i)); return v === null ? null : -v; } : e; break; }
    case 'bin': { const [l, r] = [rowFn(n.l, en), rowFn(n.r, en)]; f = (i) => binary(n.op, l(i), r(i)); break; }
    case 'call': {
      const name = fnName(n.name);
      const args = n.args.map((a) => rowFn(a, en));
      if (name === 'IF') f = (i) => (truthy(args[0](i)) ? args[1](i) : args[2]?.(i) ?? null);
      else f = (i) => scalarFn(name, args.map((a) => a(i)));
      break;
    }
  }
  cache.set(n, f);
  return f;
}

function resolveColumn(en: Engine, name: string) {
  return en.column(name) ?? en.table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function resolveMeasure(en: Engine, name: string): string | undefined {
  if (en.hasMeasure(name)) return name;
  return undefined;
}

function collect(arg: Node, en: Engine, rows: Uint32Array): number[] {
  if (arg.t === 'ref') { const c = resolveColumn(en, arg.name); return c ? en.numbers(c.name, rows) : []; }
  const f = rowFn(arg, en);
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) { const v = num(f(rows[i])); if (v !== null && Number.isFinite(v)) out.push(v); }
  return out;
}

function filterRows(cond: Node, en: Engine, rows: Uint32Array): Uint32Array {
  const f = rowFn(cond, en);
  const out = new Uint32Array(rows.length);
  let n = 0;
  for (let i = 0; i < rows.length; i++) if (truthy(f(rows[i]))) out[n++] = rows[i];
  return out.slice(0, n);
}

function refsIn(n: Node, out: Set<string> = new Set()): Set<string> {
  if (n.t === 'ref') out.add(n.name);
  else if (n.t === 'bin') { refsIn(n.l, out); refsIn(n.r, out); }
  else if (n.t === 'un') refsIn(n.e, out);
  else if (n.t === 'call') n.args.forEach((a) => refsIn(a, out));
  return out;
}

const withoutCol = (cs: Constraint[], col: string) => cs.filter((c) => c.col.toLowerCase() !== col.toLowerCase());

interface Period { start: number; end: number; part?: DatePart }

/** The time window the current filter context covers. */
function periodOf(en: Engine, cs: Constraint[], col: string): Period | null {
  let best: { part: DatePart; start: number } | null = null;
  for (const c of cs) {
    if (c.col !== col || c.kind !== 'in' || !c.part || c.values.length !== 1 || typeof c.values[0] !== 'number') continue;
    if (!best || PART_ORDER.indexOf(c.part) < PART_ORDER.indexOf(best.part)) best = { part: c.part, start: c.values[0] };
  }
  if (best) return { start: best.start, end: bucketAdd(best.start, best.part, 1), part: best.part };
  const xs = en.numbers(col, en.rows(cs));
  if (!xs.length) return null;
  const min = xs.reduce((a, b) => (b < a ? b : a));
  const max = xs.reduce((a, b) => (b > a ? b : a));
  return { start: bucketStart(min, 'day'), end: bucketStart(max, 'day') + 86400000 };
}

export function evaluateMeasure(n: Node, en: Engine, cs: Constraint[], stack: Set<string>): Cell {
  const ev = (x: Node, c = cs) => evaluateMeasure(x, en, c, stack);
  switch (n.t) {
    case 'num': case 'str': case 'bool': return n.v;
    case 'ref': {
      const m = resolveMeasure(en, n.name);
      if (!m || stack.has(m)) return null;
      return evaluateMeasure(en.measure(m)!.node, en, cs, new Set([...stack, m]));
    }
    case 'un': { const v = num(ev(n.e)); return n.op === '-' ? (v === null ? null : -v) : v; }
    case 'bin': return binary(n.op, ev(n.l), ev(n.r));
    case 'call': break;
  }
  const name = fnName(n.name);
  const a = n.args;
  const rows = () => en.rows(cs);
  const dateCol = (i: number) => {
    const arg = a[i];
    return arg?.t === 'ref' ? resolveColumn(en, arg.name)?.name : en.firstDateColumn;
  };
  const nums = (arg: Node, r = rows()) => collect(arg, en, r);
  const orNull = (xs: number[], f: (x: number[]) => number) => (xs.length ? f(xs) : null);

  switch (name) {
    case 'SUM': return orNull(nums(a[0]), sum);
    case 'AVERAGE': return orNull(nums(a[0]), mean);
    case 'MEDIAN': return orNull(nums(a[0]), median);
    case 'MIN': return orNull(nums(a[0]), (x) => x.reduce((p, c) => (c < p ? c : p)));
    case 'MAX': return orNull(nums(a[0]), (x) => x.reduce((p, c) => (c > p ? c : p)));
    case 'STDEV': { const x = nums(a[0]); return x.length > 1 ? stdev(x) : null; }
    case 'VAR': { const x = nums(a[0]); return x.length > 1 ? variance(x) : null; }
    case 'PERCENTILE': { const p = num(ev(a[1])); return p === null ? null : orNull(nums(a[0]), (x) => quantile(x, Math.min(1, Math.max(0, p)))); }
    case 'COUNTROWS': return rows().length;
    case 'COUNT': {
      const f = rowFn(a[0], en); const r = rows(); let k = 0;
      for (let i = 0; i < r.length; i++) if (f(r[i]) !== null) k++;
      return k;
    }
    case 'DISTINCTCOUNT': {
      const f = rowFn(a[0], en); const r = rows(); const s = new Set<Cell>();
      for (let i = 0; i < r.length; i++) { const v = f(r[i]); if (v !== null) s.add(v); }
      return s.size;
    }
    case 'SUMIF': return orNull(nums(a[0], filterRows(a[1], en, rows())), sum);
    case 'AVERAGEIF': return orNull(nums(a[0], filterRows(a[1], en, rows())), mean);
    case 'COUNTIF': return filterRows(a[0], en, rows()).length;
    case 'IF': return truthy(ev(a[0])) ? ev(a[1]) : a[2] ? ev(a[2]) : null;
    case 'PARAM': return en.param(String(ev(a[0])));
    case 'CALCULATE': {
      let next = cs;
      for (const mod of a.slice(1)) {
        if (mod.t === 'call' && ['ALL', 'REMOVEFILTERS'].includes(fnName(mod.name))) {
          next = mod.args.length ? mod.args.reduce((c, r) => (r.t === 'ref' ? withoutCol(c, r.name) : c), next) : [];
        } else {
          const refs = [...refsIn(mod)];
          refs.forEach((r) => { next = withoutCol(next, r); });
          next = [...next, { col: refs[0] ?? '*', kind: 'pred', key: JSON.stringify(mod), test: ((f) => (i: number) => truthy(f(i)))(rowFn(mod, en)) }];
        }
      }
      return ev(a[0], next);
    }
    case 'PCTOFTOTAL': {
      const top = num(ev(a[0]));
      const base = a[1]?.t === 'ref' ? withoutCol(cs, a[1].name) : cs.filter((c) => c.kind === 'pred' || !c.group);
      const bottom = num(ev(a[0], base));
      return top === null || bottom === null || bottom === 0 ? null : top / bottom;
    }
    case 'PREVIOUSYEAR': case 'PREVIOUSPERIOD': case 'YTD': {
      const col = dateCol(1);
      if (!col) return null;
      const p = periodOf(en, cs, col);
      if (!p) return null;
      let range: [number, number];
      if (name === 'PREVIOUSYEAR') range = [shiftYears(p.start, -1), shiftYears(p.end, -1)];
      else if (name === 'YTD') range = [Date.UTC(new Date(p.end - 1).getUTCFullYear(), 0, 1), p.end];
      else if (p.part) range = [bucketAdd(p.start, p.part, -1), p.start];
      else range = [p.start - (p.end - p.start), p.start];
      return ev(a[0], [...withoutCol(cs, col), { col, kind: 'range', min: range[0], max: range[1] }]);
    }
    case 'RUNNINGSUM': case 'MOVINGAVG': {
      const col = dateCol(1);
      if (!col) return null;
      const p = periodOf(en, cs, col);
      if (!p) return null;
      if (!p.part && name === 'RUNNINGSUM') return ev(a[0]);
      const part: DatePart = p.part ?? 'month';
      const current = p.part ? p.start : bucketStart(p.end - 1, 'month');
      const base = cs.filter((c) => !(c.col === col && c.kind !== 'pred' && c.group));
      const at = (k: number) => [...base, groupConstraint({ col, part }, k)];
      if (name === 'RUNNINGSUM') {
        const keys = [...en.groupRows(base, { col, part }).keys()].filter((k): k is number => typeof k === 'number' && k <= current);
        const xs = keys.map((k) => num(ev(a[0], at(k)))).filter((v): v is number => v !== null);
        return xs.length ? sum(xs) : null;
      }
      const periods = Math.max(1, Math.round(num(ev(a[2])) ?? 1));
      const present = en.groupRows(base, { col, part });
      const xs: number[] = [];
      for (let k = 0; k < periods; k++) {
        const key = bucketAdd(current, part, -k);
        if (!present.has(key)) continue;
        const v = num(ev(a[0], at(key)));
        if (v !== null) xs.push(v);
      }
      return xs.length ? mean(xs) : null;
    }
    default:
      return scalarFn(name, a.map((x) => ev(x)));
  }
}

export const isAggregateName = (n: string) => AGG_NAMES.has(n);
