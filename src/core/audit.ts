// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { AGE_NAME, IDENTIFIER_NAME, PERSON_NAME, type InferredColumn } from './parse';
import { getColumn } from './recipe';
import type { Cell, CellChange, Column, DataTable, Finding, Step } from './types';
import { sum } from './stats';

/**
 * Computation audit: finds calculation errors already inside an uploaded report and proposes fixes.
 * Original values are never destroyed. Each fix is a recipe step that can be switched off.
 */

const TOTAL_LABEL = /^\s*((grand|sub|overall|net)[\s-]*)?(total|totals|sum|subtotal)\b|^\s*(overall|all regions|all categories)\s*$/i;
const NON_NEGATIVE = /(qty|quantity|units?|count|price|age|stock|headcount)/i;

const fmt = (v: Cell) => (v === null ? 'blank' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(v));

function roundTo(v: number, d: number) {
  const f = 10 ** d;
  return Math.round((v + Number.EPSILON * Math.sign(v)) * f) / f;
}

function decimalsOf(c: Column): number {
  if (c.decimals !== undefined) return c.decimals;
  let d = 0;
  for (const v of c.values) {
    if (typeof v !== 'number') continue;
    const s = String(v);
    const at = s.indexOf('.');
    if (at >= 0 && !s.includes('e')) d = Math.max(d, s.length - at - 1);
  }
  return Math.min(d, 6);
}

interface Rule { target: string; inputs: string[]; label: string; fn: (xs: number[]) => number; rate: number; n: number; }

function numericCols(t: DataTable) {
  return t.columns.filter((c) => c.type === 'number' && c.role !== 'id');
}

function matches(actual: number, expected: number, dec: number) {
  if (!Number.isFinite(expected)) return false;
  const tol = Math.max(0.5 * 10 ** -dec + 1e-9, Math.abs(expected) * 1e-6);
  return Math.abs(actual - expected) <= tol * 1.02;
}

/** Finds columns that are arithmetic results of columns to their left. */
export function detectRules(t: DataTable, active: number[]): Rule[] {
  const cols = numericCols(t).slice(0, 30);
  const step = Math.max(1, Math.floor(active.length / 3000));
  const sample = active.filter((_, i) => i % step === 0);
  const rules: Rule[] = [];

  const usable = (c: Column) => {
    const set = new Set<number>();
    for (const i of sample) { const v = c.values[i]; if (typeof v === 'number') set.add(v); if (set.size > 2) return true; }
    return set.size > 1;
  };

  for (let ti = 2; ti < cols.length; ti++) {
    const target = cols[ti];
    if (!usable(target)) continue;
    const dec = decimalsOf(target);
    let best: Rule | null = null;

    const consider = (inputs: Column[], label: string, fn: (xs: number[]) => number) => {
      let n = 0;
      let ok = 0;
      for (const i of sample) {
        const y = target.values[i];
        if (typeof y !== 'number') continue;
        const xs = inputs.map((c) => c.values[i]);
        if (xs.some((x) => typeof x !== 'number')) continue;
        n++;
        if (matches(y, fn(xs as number[]), dec)) ok++;
      }
      if (n < 5) return;
      const rate = ok / n;
      if (rate >= 0.7 && (!best || rate > best.rate + 1e-9)) {
        best = { target: target.name, inputs: inputs.map((c) => c.name), label, fn, rate, n };
      }
    };

    for (let a = 0; a < ti; a++) {
      for (let b = a + 1; b < ti; b++) {
        const A = cols[a];
        const B = cols[b];
        if (!usable(A) || !usable(B)) continue;
        consider([A, B], `[${A.name}] × [${B.name}]`, ([x, y]) => x * y);
        consider([A, B], `[${A.name}] + [${B.name}]`, ([x, y]) => x + y);
        consider([A, B], `[${A.name}] − [${B.name}]`, ([x, y]) => x - y);
        consider([A, B], `[${A.name}] ÷ [${B.name}]`, ([x, y]) => (y === 0 ? NaN : x / y));
        consider([A, B], `[${A.name}] ÷ [${B.name}] × 100`, ([x, y]) => (y === 0 ? NaN : (x / y) * 100));
        consider([A, B], `[${B.name}] ÷ [${A.name}]`, ([x, y]) => (x === 0 ? NaN : y / x));
        consider([A, B], `[${B.name}] ÷ [${A.name}] × 100`, ([x, y]) => (x === 0 ? NaN : (y / x) * 100));
      }
    }
    // Row totals such as Total = Q1 + Q2 + Q3 + Q4.
    for (let k = 3; k <= Math.min(14, ti); k++) {
      const inputs = cols.slice(ti - k, ti);
      consider(inputs, inputs.map((c) => `[${c.name}]`).join(' + '), (xs) => sum(xs));
    }
    if (best) rules.push(best);
  }
  return rules;
}

/** True for one missing, extra, or swapped letter. A replaced letter is not enough, because Bago and Bato are different places. */
function oneTypo(a: string, b: string) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 5 || long.length - short.length > 1 || a === b) return false;
  if (/\d/.test(long) || /^[ivxlcdm]+$/.test(short) || /^[ivxlcdm]+$/.test(long)) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (long.length > short.length) return long.slice(i + 1) === short.slice(i);
  return short[i] === long[i + 1] && short[i + 1] === long[i] && short.slice(i + 2) === long.slice(i + 2);
}

/** Labels match when every word is the same except one word with a single typing slip. */
export function isLikelyTypo(a: string, b: string) {
  const [x, y] = [a.split(' '), b.split(' ')];
  if (x.length !== y.length) return false;
  const differ = x.flatMap((w, i) => (w === y[i] ? [] : [i]));
  return differ.length === 1 && oneTypo(x[differ[0]], y[differ[0]]);
}

function isTotalRow(i: number, labels: Column[]): string | null {
  for (const c of labels) {
    const v = c.values[i];
    if (typeof v === 'string' && TOTAL_LABEL.test(v)) return v;
  }
  return null;
}

export function runAudit(t: DataTable, inferred: InferredColumn[] = []): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'id'>) => findings.push({ ...f, id: `${f.kind}:${f.column ?? ''}:${findings.length}` });
  const labels = t.columns.filter((c) => c.type === 'category' || c.type === 'text');
  const nums = numericCols(t);

  // A "Total" label can also sit in a date or number column, where it reads as an invalid value.
  const strayTotals = new Map<number, string>();
  if (inferred.length === t.columns.length) {
    inferred.forEach((inf) => inf.invalid.forEach((x) => { if (TOTAL_LABEL.test(x.text)) strayTotals.set(x.row, x.text); }));
  }

  /* 1. Spreadsheet errors and numbers typed as text ------------------------------------------ */
  inferred.forEach((source) => {
    const inf = { ...source, invalid: source.invalid.filter((x) => !strayTotals.has(x.row)) };
    const name = inf.column.name;
    if (inf.errorCells.length) {
      add({
        kind: 'sheet-error', severity: 'error', column: name, count: inf.errorCells.length, auto: false, steps: [], changes: [],
        title: `${inf.errorCells.length} spreadsheet error${inf.errorCells.length > 1 ? 's' : ''} in ${name}`,
        detail: 'Cells such as #DIV/0! or #REF! are treated as blank so they cannot break totals. They are recalculated when the column has a detectable formula.',
      });
    }
    if (inf.convertedText.length) {
      add({
        kind: 'text-number', severity: 'info', column: name, count: inf.convertedText.length, auto: true, steps: [], changes: [],
        title: `${inf.convertedText.length.toLocaleString()} numbers stored as text in ${name}`,
        detail: 'Values with currency signs, separators, brackets, or percent signs were converted to real numbers.',
      });
    }
    if (inf.invalid.length) {
      const eg = inf.invalid.slice(0, 3).map((x) => `"${x.text}"`).join(', ');
      add({
        kind: 'invalid-value', severity: 'warning', column: name, count: inf.invalid.length, auto: false, steps: [], changes: [],
        title: `${inf.invalid.length} unreadable value${inf.invalid.length > 1 ? 's' : ''} in ${name}`,
        detail: `Examples: ${eg}. These are left blank and excluded from calculations. Review them in the source file.`,
      });
    }
    if (inf.ambiguousDates) {
      add({
        kind: 'ambiguous-date', severity: 'warning', column: name, count: t.rowCount, auto: false, steps: [], changes: [],
        title: `Dates in ${name} could be day-first or month-first`,
        detail: 'Every date is valid both ways, so month-first was used. Change the date format in the Prepare toolbar if that is wrong.',
      });
    }
  });

  /* 2. Total rows mixed into the data (these double count every sum) -------------------------- */
  const totalRows: number[] = [];
  const excluded = new Set<number>();
  const totalLabels = new Map<number, string>();
  for (let i = 0; i < t.rowCount; i++) {
    const label = isTotalRow(i, labels) ?? strayTotals.get(i) ?? null;
    if (!label) continue;
    totalRows.push(t.rowIds[i]);
    excluded.add(i);
    totalLabels.set(i, label);
  }
  // An unlabeled last row that equals the sum of every row above it.
  const last = t.rowCount - 1;
  if (t.rowCount > 3 && !excluded.has(last) && labels.every((c) => c.values[last] === null) && nums.length) {
    const additive = nums.filter((c) => c.role === 'measure' && typeof c.values[last] === 'number');
    const allMatch = additive.length > 0 && additive.every((c) => {
      const xs = c.values.slice(0, last).filter((v): v is number => typeof v === 'number');
      return xs.length > 1 && matches(c.values[last] as number, sum(xs), Math.max(decimalsOf(c), 2));
    });
    if (allMatch) { totalRows.push(t.rowIds[last]); excluded.add(last); }
  }
  if (totalRows.length) {
    add({
      kind: 'total-row', severity: 'error', count: totalRows.length, auto: true,
      steps: [{ op: 'excludeRows', rows: totalRows, reason: 'Total row inside the data' }], changes: [],
      title: `${totalRows.length} total row${totalRows.length > 1 ? 's' : ''} removed from the data`,
      detail: 'Total and subtotal rows would be counted twice in every sum, so they are excluded.',
    });
  }

  const active: number[] = [];
  for (let i = 0; i < t.rowCount; i++) if (!excluded.has(i)) active.push(i);

  /* 3. Row calculations that disagree with the rest of the column ----------------------------- */
  const rules = detectRules(t, active);
  const working = new Map<string, Cell[]>();
  const valuesOf = (name: string) => working.get(name) ?? getColumn(t, name)!.values;
  for (const rule of rules) {
    const target = getColumn(t, rule.target)!;
    const dec = decimalsOf(target);
    const inputs = rule.inputs.map(valuesOf);
    const changes: CellChange[] = [];
    const fixed = [...target.values];
    let blanks = 0;
    for (const i of active) {
      const xs = inputs.map((c) => c[i]);
      if (xs.some((x) => typeof x !== 'number')) continue;
      const expected = rule.fn(xs as number[]);
      if (!Number.isFinite(expected)) continue;
      const y = target.values[i];
      if (typeof y === 'number' && matches(y, expected, dec)) continue;
      const value = roundTo(expected, dec);
      if (y === null) blanks++;
      fixed[i] = value;
      changes.push({
        row: t.rowIds[i], column: target.name, before: y, after: value,
        reason: y === null ? `Missing result recalculated as ${rule.label}` : `Should equal ${rule.label}`,
      });
    }
    working.set(rule.target, fixed);
    if (!changes.length) continue;
    const wrong = changes.length - blanks;
    const eg = changes.find((c) => c.before !== null) ?? changes[0];
    add({
      kind: 'wrong-calculation', severity: 'error', column: target.name, count: changes.length, auto: true, changes,
      steps: [{ op: 'setCells', col: target.name, changes: changes.map((c) => ({ row: c.row, value: c.after })), reason: `${target.name} = ${rule.label}` }],
      title: `${changes.length.toLocaleString()} wrong calculation${changes.length > 1 ? 's' : ''} corrected in ${target.name}`,
      detail: `${Math.round(rule.rate * 100)}% of rows follow ${target.name} = ${rule.label}. ${wrong} value${wrong === 1 ? '' : 's'} disagreed${blanks ? ` and ${blanks} ${blanks === 1 ? 'was' : 'were'} missing` : ''}. For example, row ${eg.row + 2} changed from ${fmt(eg.before)} to ${fmt(eg.after)}.`,
    });
  }

  /* Ages that cannot be right are recalculated from the birth date ------------------------------ */
  const ageCol = t.columns.find((c) => c.type === 'number' && AGE_NAME.test(c.name.trim()));
  if (ageCol) {
    const birth = t.columns.find((c) => c.type === 'date' && /(birth|dob)/i.test(c.name));
    const reference = t.columns.find((c) => c.type === 'date' && !/(birth|dob|expir)/i.test(c.name));
    const unreadable = new Map(inferred.find((x) => x.column.name === ageCol.name)?.invalid.map((x) => [x.row, x.text]) ?? []);
    const changes: CellChange[] = [];
    for (const i of active) {
      const v = ageCol.values[i];
      if (typeof v === 'number' ? v >= 0 && v <= 120 : !unreadable.has(i)) continue;
      const born = birth?.values[i];
      const on = typeof reference?.values[i] === 'number' ? (reference.values[i] as number) : Date.now();
      let after: number | null = null;
      if (typeof born === 'number') {
        const [b, d] = [new Date(born), new Date(on)];
        const years = d.getUTCFullYear() - b.getUTCFullYear() - (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate()) ? 1 : 0);
        if (years >= 0 && years <= 120) after = years;
      }
      changes.push({ row: t.rowIds[i], column: ageCol.name, before: unreadable.get(i) ?? v, after, reason: after === null ? 'Impossible age with no usable birth date, so it is left out' : `Impossible age recalculated from ${birth!.name}` });
    }
    if (changes.length) {
      const blocked = findings.findIndex((f) => f.kind === 'invalid-value' && f.column === ageCol.name);
      if (blocked >= 0) findings.splice(blocked, 1);
      const fixed = changes.filter((c) => c.after !== null).length;
      add({
        kind: 'impossible-age', severity: 'error', column: ageCol.name, count: changes.length, auto: true, changes,
        steps: [{ op: 'setCells', col: ageCol.name, changes: changes.map((c) => ({ row: c.row, value: c.after })), reason: 'Impossible age' }],
        title: `${changes.length.toLocaleString()} impossible ${changes.length === 1 ? 'age' : 'ages'} corrected`,
        detail: `Ages must be from 0 to 120. ${fixed} ${fixed === 1 ? 'was' : 'were'} recalculated from ${birth?.name ?? 'the birth date'}${changes.length - fixed ? `, and ${changes.length - fixed} could not be calculated, so ${changes.length - fixed === 1 ? 'it is' : 'they are'} left out` : ''}.`,
      });
    }
    if (!getColumn(t, 'Age Group')) add({
      kind: 'age-group', severity: 'info', column: 'Age Group', count: t.rowCount, auto: true, changes: [],
      steps: [{ op: 'ageBands', col: ageCol.name, name: 'Age Group' }],
      title: 'Age Group column added', detail: 'Ages are grouped as 0-17, 18-29, 30-44, 45-59, and 60 and over for reporting.',
    });
  }

  for (const f of findings) {
    if (f.kind === 'sheet-error' && rules.some((r) => r.target === f.column)) {
      f.auto = true;
      f.detail = 'Cells such as #DIV/0! or #REF! were recalculated using the formula that the rest of this column follows.';
    }
  }

  /* 4. Duplicates ------------------------------------------------------------------------------ */
  const seen = new Map<string, number>();
  const dupes: number[] = [];
  for (const i of active) {
    const k = JSON.stringify(t.columns.map((c) => c.values[i]));
    if (seen.has(k)) dupes.push(t.rowIds[i]); else seen.set(k, i);
  }
  const idCols = t.columns.filter((c) => c.role === 'id');
  if (dupes.length) {
    add({
      kind: 'duplicate-rows', severity: idCols.length ? 'error' : 'warning', count: dupes.length, auto: idCols.length > 0,
      steps: [{ op: 'excludeRows', rows: dupes, reason: 'Exact duplicate row' }], changes: [],
      title: `${dupes.length.toLocaleString()} exact duplicate row${dupes.length > 1 ? 's' : ''}`,
      detail: idCols.length
        ? `These rows repeat the same ${idCols[0].name} and every other value, so they inflate totals and were removed.`
        : 'Without an ID column these may be genuine repeat transactions, so they are kept until you choose to remove them.',
    });
  }

  /* Printed totals are judged against the corrected rows, so one mistake is never reported twice. */
  const removed = new Set(idCols.length ? dupes : []);
  const totalChanges: CellChange[] = [];
  let groupStart = 0;
  for (const [i, label] of totalLabels) {
    const isGrand = !/sub/i.test(label);
    for (const c of nums) {
      if (c.role === 'ratio') continue;
      const printed = c.values[i];
      if (typeof printed !== 'number') continue;
      const values = valuesOf(c.name);
      const xs: number[] = [];
      for (let r = isGrand ? 0 : groupStart; r < i; r++) {
        const v = values[r];
        if (typeof v === 'number' && !excluded.has(r) && !removed.has(t.rowIds[r])) xs.push(v);
      }
      if (!xs.length) continue;
      const dec = Math.max(decimalsOf(c), 2);
      const actual = roundTo(sum(xs), dec);
      if (!matches(printed, actual, dec)) {
        totalChanges.push({ row: t.rowIds[i], column: c.name, before: printed, after: actual, reason: `Printed "${label}" does not equal the sum of its rows` });
      }
    }
    if (!isGrand) groupStart = i + 1;
  }
  if (totalChanges.length) {
    const eg = totalChanges[0];
    add({
      kind: 'wrong-total', severity: 'error', column: eg.column, count: totalChanges.length, auto: true, steps: [], changes: totalChanges,
      title: `${totalChanges.length} printed total${totalChanges.length > 1 ? 's do' : ' does'} not match the data`,
      detail: `${eg.column}: the file says ${fmt(eg.before)}, but its corrected rows add up to ${fmt(eg.after)}. Reports use the total calculated from the rows.`,
    });
  }

  for (const c of idCols) {
    const counts = new Map<Cell, number>();
    for (const i of active) if (c.values[i] !== null && !removed.has(t.rowIds[i])) counts.set(c.values[i], (counts.get(c.values[i]) ?? 0) + 1);
    const repeated = [...counts.values()].filter((n) => n > 1).length;
    if (repeated > 0 && repeated / Math.max(1, counts.size) < 0.05 && !/(contact|phone|mobile|cell|tel)/i.test(c.name)) {
      add({
        kind: 'duplicate-id', severity: 'warning', column: c.name, count: repeated, auto: false, steps: [], changes: [],
        title: `${repeated} repeated value${repeated > 1 ? 's' : ''} in ${c.name}`,
        detail: 'The same ID appears on rows with different values. Check whether these are separate records.',
      });
    }
  }

  /* 5. Inconsistent labels --------------------------------------------------------------------- */
  for (const c of t.columns.filter((x) => x.type === 'category')) {
    const counts = new Map<string, number>();
    for (const i of active) { const v = c.values[i]; if (typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1); }
    const groups = new Map<string, string[]>();
    counts.forEach((_, v) => {
      const k = v.toLowerCase().replace(/\s+/g, ' ').trim();
      groups.set(k, [...(groups.get(k) ?? []), v]);
    });
    const steps: Step[] = [];
    let affected = 0;
    const eg: string[] = [];
    groups.forEach((vs) => {
      if (vs.length < 2) return;
      const main = [...vs].sort((a, b) => counts.get(b)! - counts.get(a)!)[0];
      vs.filter((v) => v !== main).forEach((v) => {
        steps.push({ op: 'replace', col: c.name, from: v, to: main });
        affected += counts.get(v)!;
        if (eg.length < 3) eg.push(`"${v}" → "${main}"`);
      });
    });
    if (steps.length) {
      add({
        kind: 'label-variants', severity: 'warning', column: c.name, count: affected, auto: true, steps, changes: [],
        title: `${affected.toLocaleString()} inconsistent label${affected > 1 ? 's' : ''} in ${c.name}`,
        detail: `Spelling variants split one group into several: ${eg.join(', ')}.`,
      });
    }

    /* A rare label one typing slip away from a far more common label is treated as a misspelling. */
    if (c.role === 'id' || PERSON_NAME.test(c.name) || IDENTIFIER_NAME.test(c.name) || groups.size < 2 || groups.size > 1500) continue;
    const totals = [...groups].map(([key, vs]) => ({ key, vs, n: vs.reduce((s, v) => s + counts.get(v)!, 0), main: [...vs].sort((a, b) => counts.get(b)! - counts.get(a)!)[0] }));
    const typoSteps: Step[] = [];
    const typoExamples: string[] = [];
    let typos = 0;
    totals.forEach((rare) => {
      const matches = totals.filter((o) => o.n >= Math.max(20, rare.n * 20) && isLikelyTypo(rare.key, o.key));
      if (matches.length !== 1) return;
      rare.vs.forEach((v) => typoSteps.push({ op: 'replace', col: c.name, from: v, to: matches[0].main }));
      typos += rare.n;
      if (typoExamples.length < 3) typoExamples.push(`"${rare.main}" (${rare.n.toLocaleString('en-US')}) → "${matches[0].main}" (${matches[0].n.toLocaleString('en-US')})`);
    });
    if (typoSteps.length) {
      add({
        kind: 'label-variants', severity: 'warning', column: c.name, count: typos, auto: true, steps: typoSteps, changes: [],
        title: `${typos.toLocaleString('en-US')} likely misspelled label${typos > 1 ? 's' : ''} in ${c.name}`,
        detail: `Each differs by one letter from a much more common label, so they were counted together: ${typoExamples.join(', ')}. Switch this off if they are really different.`,
      });
    }
  }

  /* 6. Values that should be impossible -------------------------------------------------------- */
  for (const c of nums.filter((x) => NON_NEGATIVE.test(x.name))) {
    const n = active.filter((i) => typeof c.values[i] === 'number' && (c.values[i] as number) < 0).length;
    if (n) add({
      kind: 'negative', severity: 'warning', column: c.name, count: n, auto: false, steps: [], changes: [],
      title: `${n} negative value${n > 1 ? 's' : ''} in ${c.name}`,
      detail: 'This column is normally zero or higher. They may be returns, so they are kept for you to review.',
    });
  }
  const now = Date.now();
  for (const c of t.columns.filter((x) => x.type === 'date')) {
    const n = active.filter((i) => typeof c.values[i] === 'number' && (c.values[i] as number) > now + 86400000).length;
    if (n) add({
      kind: 'future-date', severity: 'warning', column: c.name, count: n, auto: false, steps: [], changes: [],
      title: `${n} future date${n > 1 ? 's' : ''} in ${c.name}`,
      detail: 'These dates are after today. They are kept, but check whether they are forecasts or typing errors.',
    });
  }

  const order = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface QualityScore {
  score: number;
  completeness: number;
  validity: number;
  uniqueness: number;
  consistency: number;
  missingCells: number;
}

/** Weighted 0-100 score, measured on the data as uploaded so fixes do not hide the original state. */
export function qualityScore(t: DataTable, findings: Finding[]): QualityScore {
  const cells = Math.max(1, t.rowCount * t.columns.length);
  let missingCells = 0;
  for (const c of t.columns) for (const v of c.values) if (v === null) missingCells++;
  const countOf = (...kinds: string[]) => findings.filter((f) => kinds.includes(f.kind)).reduce((s, f) => s + f.count, 0);
  const completeness = 1 - missingCells / cells;
  const validity = Math.max(0, 1 - countOf('sheet-error', 'invalid-value', 'wrong-calculation', 'impossible-age', 'wrong-total', 'negative', 'future-date') / cells * 10);
  const uniqueness = Math.max(0, 1 - countOf('duplicate-rows', 'total-row') / Math.max(1, t.rowCount));
  const consistency = Math.max(0, 1 - countOf('label-variants') / Math.max(1, t.rowCount));
  const base = (completeness * 0.3 + validity * 0.35 + uniqueness * 0.2 + consistency * 0.15) * 100;
  // Each kind of problem lowers the score, even when only a few rows are affected.
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const score = Math.max(0, Math.round(base - Math.min(24, errors * 4) - Math.min(8, warnings * 2)));
  return { score, completeness, validity, uniqueness, consistency, missingCells };
}
