// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { FULL_CLEANUP, listFixes, planCleanup, TIDY_ONLY, variantKey, type CleanReason, type ValueFix } from './cleanup';
import { detectDateOrder, IDENTIFIER_NAME, parseDate, PERSON_NAME } from './parse';
import { isLikelyTypo, isSimilarEntry } from './typos';
import type { RawCell } from './types';

/**
 * MSWD performance report: patients catered per Medical Social Worker (RSW), per month and overall,
 * split by type of patient, classification, place-name misspellings, and new or old patients.
 * The counting rules copy the COUNTIFS formulas of the original workbook exactly, so the numbers
 * computed here and the formulas written to Excel always agree.
 */

export const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
export const EM = '—';
export const EN = '–';
export const DAY = 86400000;

export type MswdField =
  | 'month' | 'date' | 'timestamp' | 'worker' | 'patientType' | 'patientStatus' | 'typeOfPatient' | 'classification' | 'service' | 'hospitalNo'
  | 'barangay' | 'municipality' | 'province' | 'region'
  | 'barangayError' | 'municipalityError' | 'provinceError' | 'regionError' | 'totalErrors';

export type MswdColumns = Partial<Record<MswdField, number>>;

export const FIELD_LABELS: Record<MswdField, string> = {
  month: 'Month', date: 'Date of service', timestamp: 'Timestamp', worker: 'Medical Social Worker (RSW)', patientType: 'Patient type (NEW or OLD)',
  patientStatus: 'Patient status (New or Old)', typeOfPatient: 'Type of patient (ER, ER/ED, OP, IP)', classification: 'Classification (B, C1, C2, C3, N/A)',
  service: 'Service', hospitalNo: 'Hospital No.',
  barangay: 'Barangay', municipality: 'Municipality', province: 'Province', region: 'Region',
  barangayError: 'Barangay Error', municipalityError: 'Municipality Error', provinceError: 'Province Error', regionError: 'Region Error', totalErrors: 'Total Place-Name Errors',
};

/** Header patterns, best match first. Exact patterns keep "Region (Address of Referring Jail Facility)" away from Region. */
const PATTERNS: Record<MswdField, RegExp[]> = {
  month: [/^month$/i, /^(report(ing)?\s+)?month(\s*(and|&|\/)\s*year)?$/i],
  date: [/^date\s*(and|&)?\s*time$/i, /^date of (service|visit|consultation|interview)$/i, /^date$/i],
  timestamp: [/^timestamp$/i, /^time\s*stamp$/i],
  worker: [/^medical social worker$/i, /^(r|m)sw( names?)?$/i, /social worker/i],
  patientType: [/^patient type$/i, /^(new|old)\s*(or|\/)\s*(old|new)/i],
  patientStatus: [/^patient status$/i],
  typeOfPatient: [/^type of patient$/i, /type of patient/i],
  classification: [/^classification$/i, /^(social\s+)?classification\b/i],
  service: [/^services?$/i],
  hospitalNo: [/^hospital\s*(no\.?|number|#)$/i, /^hrn$/i],
  barangay: [/^barangay$/i, /^brgy\.?$/i],
  municipality: [/^municipality$/i, /^(city|municipality)\s*\/\s*(city|municipality)$/i, /^city$/i],
  province: [/^province$/i],
  region: [/^region$/i],
  barangayError: [/^barangay error$/i],
  municipalityError: [/^municipality error$/i],
  provinceError: [/^province error$/i],
  regionError: [/^region error$/i],
  totalErrors: [/^total place[\s-]?name errors$/i],
};

export function detectColumns(headers: string[]): MswdColumns {
  const out: MswdColumns = {};
  const used = new Set<number>();
  const clean = headers.map((h) => String(h ?? '').replace(/\s+/g, ' ').trim());
  for (const field of Object.keys(PATTERNS) as MswdField[]) {
    for (const re of PATTERNS[field]) {
      const at = clean.findIndex((h, i) => !used.has(i) && re.test(h));
      if (at >= 0) { out[field] = at; used.add(at); break; }
    }
  }
  return out;
}

export const missingRequired = (c: MswdColumns) => (['worker'] as MswdField[]).filter((f) => c[f] === undefined)
  .concat(c.month === undefined && c.date === undefined && c.timestamp === undefined ? ['month'] : []);

/* ---------- Months ---------- */

const toMs = (v: RawCell): number | null => {
  if (v && typeof v === 'object') return v.date;
  if (typeof v === 'number' && v > 20000 && v < 80000) return Math.round((v - 25569) * DAY);
  return null;
};
const SHORT = MONTHS.map((m) => m.slice(0, 3));
export const dayOf = (ms: number) => Math.floor(ms / DAY) * DAY;

/** A service date more than this long before its entry is taken as a typing slip, such as a wrong year. */
const LATE_ENTRY = 45 * DAY;

/**
 * The date of a row: the date of service, or the timestamp when the service date is blank, later than the entry itself,
 * or so much earlier that it must be a typing slip (a wrong year, for example).
 */
export function rowDate(r: RawCell[], c: MswdColumns): number | null {
  const served = toMs(c.date !== undefined ? r[c.date] : null);
  const stamped = toMs(c.timestamp !== undefined ? r[c.timestamp] : null);
  if (served === null || stamped === null) return served ?? stamped;
  return served > stamped + DAY || served < stamped - LATE_ENTRY ? stamped : served;
}

/** The moment a row was entered: the Timestamp, or the date of service when there is no Timestamp. */
export function entryTime(r: RawCell[], c: MswdColumns): number | null {
  return toMs(c.timestamp !== undefined ? r[c.timestamp] : null) ?? toMs(c.date !== undefined ? r[c.date] : null);
}

/** Reads "JANUARY 2026", "Jan 2026", "January", "2026-01", "01/2026", or a date. */
export function monthOf(v: RawCell, fallbackYear?: number): { label: string; key: number } | null {
  const ms = toMs(v);
  if (ms !== null) { const d = new Date(ms); return make(d.getUTCMonth(), d.getUTCFullYear()); }
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  const word = s.match(/\b([A-Z]{3,9})\.?\b/g)?.map((w) => w.replace('.', '')).find((w) => MONTHS.includes(w) || SHORT.includes(w) || w === 'SEPT');
  const year = s.match(/\b(19|20)\d{2}\b/)?.[0];
  if (word) return make(word === 'SEPT' ? 8 : Math.max(MONTHS.indexOf(word), SHORT.indexOf(word)), year ? Number(year) : fallbackYear);
  const ym = s.match(/^((?:19|20)\d{2})[-/.](\d{1,2})$/);
  const my = s.match(/^(\d{1,2})[-/.]((?:19|20)\d{2})$/);
  const [y, m] = ym ? [Number(ym[1]), Number(ym[2])] : my ? [Number(my[2]), Number(my[1])] : [0, 0];
  if (m >= 1 && m <= 12) return make(m - 1, y);
  return null;
}
function make(m: number, year?: number) {
  return { label: year ? `${MONTHS[m]} ${year}` : MONTHS[m], key: (year ?? 0) * 12 + m };
}

/** The first and last day of a month label such as "JANUARY 2026", as UTC midnights. */
export function monthRange(label: string): { from: number; to: number } | null {
  const m = monthOf(label);
  if (!m || m.key < 12) return null;
  const year = Math.floor(m.key / 12);
  const month = m.key % 12;
  return { from: Date.UTC(year, month, 1), to: Date.UTC(year, month + 1, 0) };
}

/* ---------- Preparing the data ---------- */

export interface CleanupColumn { col: number; name: string; fixes: ValueFix[] }

/** One misspelled place name, how often it was entered, and in which months. */
export interface AuditLine { field: string; reason: string; value: string; municipality: string; times: number; byMonth: Map<string, number> }

export interface Prepared {
  headers: string[];
  rows: RawCell[][];
  cols: MswdColumns;
  /** Month labels in calendar order, with the key used for sorting. */
  months: { label: string; key: number }[];
  /** Columns that were added because the file did not have them. */
  added: string[];
  monthFixed: number;
  workerFixed: number;
  /** Misspelled place names found by this app. Empty when the file already had its own error columns. */
  audit: AuditLine[];
  /** Cells outside the counted columns whose extra spaces were trimmed. */
  trimmed: number;
}

export interface PrepareOptions {
  /** Trims extra spaces, tabs, and invisible characters in every cell the entry corrections do not cover. Letters are never changed. */
  trim?: boolean;
}

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
/** Removes spaces at both ends, repeated spaces, tabs, and invisible characters. Line breaks inside notes are kept. */
export function trimText(s: string): string {
  return s.replace(ZERO_WIDTH, '').replace(/[^\S\r\n]+/g, ' ').replace(/ *\r?\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

const PLACE_FIELDS = ['barangay', 'municipality', 'province', 'region'] as const;
type PlaceField = typeof PLACE_FIELDS[number];
const PLACE_LABEL: Record<PlaceField, string> = { barangay: 'Barangay', municipality: 'Municipality', province: 'Province', region: 'Region' };
/**
 * Entry corrections that count as a misspelled place name, and the word written in the error column.
 * Spacing, letter case, and stray commas are corrected but are not misspellings.
 */
const ERROR_WORD: Partial<Record<CleanReason, string>> = { 'likely typo': 'typo', 'similar spelling': 'typo' };
/** Only the columns the report counts are corrected. Names, numbers, and notes stay exactly as they were entered. */
const CORRECTED: MswdField[] = ['worker', 'patientType', 'patientStatus', 'typeOfPatient', 'classification', 'service', 'barangay', 'municipality', 'province', 'region'];
const CODE_NAME = /(^|\s)(no\.?|number|id|code)$|control no|hospital no|philhealth id/i;

/**
 * Plans the entry corrections for every text column. Nothing is changed until `prepare` applies them.
 * A barangay is matched to a misspelling only when both appear under the same municipality,
 * because two real barangays in different towns can differ by one letter.
 */
export function planEntryCleanup(headers: string[], rows: RawCell[][], cols: MswdColumns): CleanupColumn[] {
  const out: CleanupColumn[] = [];
  const plans = new Map<number, Map<string, { to: string }>>();
  const wanted = new Set(CORRECTED.map((f) => cols[f]).filter((c): c is number => c !== undefined && c < headers.length));
  const order = [...wanted].sort((a, b) => Number(a === cols.barangay) - Number(b === cols.barangay) || a - b);
  for (const c of order) {
    const counts = new Map<string, number>();
    for (const r of rows) { const v = r[c]; if (typeof v === 'string' && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1); }
    if (!counts.size) continue;
    let context: Map<string, Set<string>> | undefined;
    if (c === cols.barangay && cols.municipality !== undefined) {
      const town = plans.get(cols.municipality);
      context = new Map();
      for (const r of rows) {
        const v = r[c];
        const t = r[cols.municipality];
        if (typeof v !== 'string' || typeof t !== 'string') continue;
        const place = variantKey(town?.get(t)?.to ?? t);
        if (!place) continue;
        const set = context.get(v) ?? new Set<string>();
        set.add(place);
        context.set(v, set);
      }
    }
    const name = String(headers[c] ?? '').trim();
    const code = IDENTIFIER_NAME.test(name) || CODE_NAME.test(name);
    const plan = planCleanup(counts, code ? TIDY_ONLY : { ...FULL_CLEANUP, typos: !PERSON_NAME.test(name) }, context);
    const field = (Object.keys(cols) as MswdField[]).find((f) => cols[f] === c);
    if (field) codeFixes(field, counts, plan);
    plans.set(c, plan);
    const fixes = listFixes(counts, plan);
    if (fixes.length) out.push({ col: c, name, fixes });
  }
  return out.sort((a, b) => a.col - b.col);
}

/**
 * Adds corrections chosen by a person, such as treating a misspelled worker name as another worker.
 * `merges` maps a name as it reads after the automatic corrections to the name it should become.
 */
export function withMerges(plan: CleanupColumn[], headers: string[], rows: RawCell[][], col: number, merges: Map<string, string>): CleanupColumn[] {
  if (!merges.size) return plan;
  const own = plan.find((p) => p.col === col);
  const fixes = new Map((own?.fixes ?? []).map((f) => [f.from, f]));
  const counts = new Map<string, number>();
  for (const r of rows) { const v = r[col]; if (typeof v === 'string' && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1); }
  counts.forEach((n, v) => {
    const to = merges.get(fixes.get(v)?.to ?? v);
    if (to !== undefined && to !== v) fixes.set(v, { from: v, to, reason: 'likely typo', count: n });
  });
  const next: CleanupColumn = { col, name: own?.name ?? String(headers[col] ?? '').trim(), fixes: [...fixes.values()].sort((a, b) => b.count - a.count) };
  return own ? plan.map((p) => (p === own ? next : p)) : [...plan, next].sort((a, b) => a.col - b.col);
}

/**
 * Wrong entries in the coded columns: other ways of writing a code the report counts, such as OPD or "Out Patient"
 * for OP, ER-ED for ER/ED, C-3 for C3, NA for N/A, or "New Patient" for New. Unclear entries are left alone.
 */
const CODES: Partial<Record<MswdField, Record<string, string[]>>> = {
  typeOfPatient: {
    ER: ['ER', 'EMERGENCY', 'EMERGENCYROOM'],
    'ER/ED': ['ER/ED', 'ERED', 'ED/ER', 'EDER', 'ED', 'EMERGENCYDEPARTMENT'],
    OP: ['OP', 'OPD', 'OUTPATIENT', 'OUTPATIENTDEPARTMENT', 'OPDPATIENT'],
    IP: ['IP', 'IPD', 'INPATIENT', 'INPATIENTDEPARTMENT', 'ADMITTED'],
  },
  classification: {
    B: ['B'], C1: ['C1', 'CI'], C2: ['C2', 'CII'], C3: ['C3', 'CIII'], 'N/A': ['N/A', 'NA', 'NOTAPPLICABLE'],
  },
  patientType: { NEW: ['NEW', 'NEWPATIENT', 'NEWCASE'], OLD: ['OLD', 'OLDPATIENT', 'OLDCASE', 'RETURNING', 'RETURNINGPATIENT'] },
  patientStatus: { NEW: ['NEW', 'NEWPATIENT', 'NEWCASE'], OLD: ['OLD', 'OLDPATIENT', 'OLDCASE', 'RETURNING', 'RETURNINGPATIENT'] },
};
const codeKey = (s: string) => s.toUpperCase().replace(/^(CLASS(IFICATION)?|TYPE)\b/, '').replace(/[^A-Z0-9/]/g, '');

/** The code an entry stands for, or null when it is not one of the known ways of writing a code. */
export function codeFor(field: MswdField, value: string): string | null {
  const codes = CODES[field];
  if (!codes) return null;
  const key = codeKey(value);
  for (const [code, ways] of Object.entries(codes)) if (ways.includes(key)) return code;
  return null;
}

/** Adds the wrong-entry fixes of one coded column. A code keeps the spelling the column already uses most, such as "New". */
function codeFixes(field: MswdField, counts: Map<string, number>, plan: Map<string, { to: string; reason: CleanReason }>) {
  if (!CODES[field]) return;
  const spelling = new Map<string, { s: string; n: number }>();
  counts.forEach((n, v) => {
    const now = plan.get(v)?.to ?? v;
    const code = Object.keys(CODES[field]!).find((c) => c.toUpperCase() === now.toUpperCase().trim());
    if (code && (spelling.get(code)?.n ?? 0) < n) spelling.set(code, { s: now, n });
  });
  counts.forEach((_, v) => {
    const now = plan.get(v)?.to ?? v;
    const code = codeFor(field, now);
    if (!code || code.toUpperCase() === now.toUpperCase()) return;
    plan.set(v, { to: spelling.get(code)?.s ?? code, reason: 'wrong entry' });
  });
}

/** Wildcards would change what COUNTIFS matches, so they never stay in a name. */
const noWildcards = (s: string) => s.replace(/[*?~]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Place names entered in the wrong column, such as a municipality typed as the province.
 * A value is flagged when it is common in another place column and at least 20 times rarer in its own.
 * Barangays are not checked, because many barangays share their name with a town elsewhere.
 */
export function wrongFieldKeys(rows: RawCell[][], cols: MswdColumns, value: (r: RawCell[], c: number) => RawCell): Map<PlaceField, Set<string>> {
  const counts = new Map<PlaceField, Map<string, number>>();
  for (const f of PLACE_FIELDS) {
    const c = cols[f];
    if (c === undefined) continue;
    const m = new Map<string, number>();
    for (const r of rows) { const v = value(r, c); if (typeof v === 'string') { const k = variantKey(v); if (k) m.set(k, (m.get(k) ?? 0) + 1); } }
    counts.set(f, m);
  }
  const out = new Map<PlaceField, Set<string>>();
  for (const f of ['municipality', 'province', 'region'] as const) {
    const own = counts.get(f);
    if (!own) continue;
    const set = new Set<string>();
    own.forEach((n, k) => {
      for (const g of PLACE_FIELDS) {
        if (g === f || (g === 'barangay' && f !== 'municipality')) continue;
        const there = counts.get(g)?.get(k) ?? 0;
        if (there >= 10 && n * 20 <= there) { set.add(k); break; }
      }
    });
    out.set(f, set);
  }
  return out;
}

/**
 * Applies the chosen corrections, writes every month the same way, and adds the Month, Patient Type,
 * and place-name error columns when the file does not have them. The original rows are never changed.
 * Rows are put in month order, then in the order they were entered.
 */
export function prepare(headers: string[], rows: RawCell[][], cols: MswdColumns, plan: CleanupColumn[], skip: Set<string> = new Set(), opts: PrepareOptions = {}): Prepared {
  const maps = new Map<number, Map<string, { to: string; reason: CleanReason }>>();
  for (const p of plan) {
    const m = new Map<string, { to: string; reason: CleanReason }>();
    for (const f of p.fixes) if (!skip.has(`${p.col}\u0001${f.from}`)) m.set(f.from, { to: f.to, reason: f.reason });
    if (m.size) maps.set(p.col, m);
  }
  const fixed = (r: RawCell[], c: number): RawCell => { const v = r[c]; return typeof v === 'string' ? maps.get(c)?.get(v)?.to ?? v : v; };
  const places = PLACE_FIELDS.filter((f) => cols[f] !== undefined);
  const deriveErrors = places.length > 0 && cols.barangayError === undefined && cols.municipalityError === undefined && cols.provinceError === undefined && cols.regionError === undefined && cols.totalErrors === undefined;
  const wrong = deriveErrors ? wrongFieldKeys(rows, cols, fixed) : new Map<PlaceField, Set<string>>();

  // Column layout of the finished table: original columns, with Month first and Patient Type after it when they are added.
  const addMonth = cols.month === undefined;
  const addType = cols.patientType === undefined && cols.patientStatus !== undefined;
  const layout: (number | 'month' | 'type')[] = headers.map((_, i) => i);
  if (addType) layout.splice(addMonth ? 0 : cols.month! + 1, 0, 'type');
  if (addMonth) layout.unshift('month');
  const added: string[] = [...(addMonth ? ['Month'] : []), ...(addType ? ['Patient Type'] : [])];
  const outHeaders = layout.map((x) => (x === 'month' ? 'Month' : x === 'type' ? 'Patient Type' : opts.trim ? trimText(String(headers[x] ?? '')) : String(headers[x] ?? '').trim()));
  const outCols: MswdColumns = {};
  for (const k of Object.keys(cols) as MswdField[]) outCols[k] = layout.indexOf(cols[k]!);
  if (addMonth) outCols.month = layout.indexOf('month');
  if (addType) outCols.patientType = layout.indexOf('type');
  const errorFields = ['barangayError', 'municipalityError', 'provinceError', 'regionError'] as const;
  if (deriveErrors) {
    const base = outHeaders.length;
    errorFields.forEach((f, i) => { outCols[f] = base + i; });
    outCols.totalErrors = base + 4;
    const names = ['Barangay Error', 'Municipality Error', 'Province Error', 'Region Error', 'Total Place-Name Errors'];
    outHeaders.push(...names);
    added.push(...names);
  }

  // Dates typed as text, as in a CSV download of form responses ("11/1/2026 9:29:34"), become real dates.
  const dateOrder = new Map<number, 'mdy' | 'dmy'>();
  for (const c of [cols.timestamp, cols.date]) {
    if (c === undefined) continue;
    const texts = rows.slice(0, 2000).map((r) => r[c]).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (texts.length) dateOrder.set(c, detectDateOrder(texts).order);
  }
  const asDate = (v: RawCell, c: number): RawCell => {
    const order = dateOrder.get(c);
    if (!order || typeof v !== 'string') return v;
    const ms = parseDate(v, order);
    return ms === null ? v : { date: ms };
  };

  // The counted columns have their own corrections, which can be reviewed one by one; every other text cell is trimmed.
  const reviewed = new Set(CORRECTED.map((f) => cols[f]).filter((c): c is number => c !== undefined));
  let trimmed = 0;
  const tidy = (v: string, c: number): RawCell => {
    if (!opts.trim || reviewed.has(c)) return v;
    const t = trimText(v);
    if (t === v) return v;
    trimmed++;
    return t === '' ? null : t;
  };

  const months = new Map<string, number>();
  const audit = new Map<string, AuditLine>();
  let monthFixed = 0;
  let workerFixed = 0;
  const built = rows.map((r) => {
    const row = r.map((v, c) => {
      if (typeof v !== 'string') return v;
      if (dateOrder.has(c)) return asDate(v, c);
      const fix = maps.get(c)?.get(v);
      return fix ? fix.to : tidy(v, c);
    });
    if (cols.worker !== undefined) {
      const w = row[cols.worker];
      if (typeof w === 'string' && /[*?~]/.test(w)) { row[cols.worker] = noWildcards(w); workerFixed++; }
    }
    // Month: the Month column decides. A date is used only when the month is blank or unreadable.
    const when = rowDate(row, cols);
    const year = when === null ? undefined : new Date(when).getUTCFullYear();
    const given = cols.month !== undefined ? row[cols.month] : null;
    const m = monthOf(given, year) ?? (when !== null ? monthOf({ date: when }) : null);
    if (m) months.set(m.label, m.key);
    if (!addMonth && cols.month !== undefined && (m?.label ?? given) !== given) { row[cols.month] = m?.label ?? given; monthFixed++; }
    const status = addType ? row[cols.patientStatus!] : null;
    const next: RawCell[] = layout.map((x) => (x === 'month' ? m?.label ?? null : x === 'type' ? (typeof status === 'string' ? status.replace(/\s+/g, ' ').trim().toUpperCase() || null : status) : row[x]));
    if (deriveErrors) {
      const flags = PLACE_FIELDS.map((f) => {
        const c = cols[f];
        if (c === undefined) return null;
        const v = r[c];
        if (typeof v !== 'string') return null;
        const key = variantKey(fixed(r, c) as string);
        const fix = maps.get(c)?.get(v);
        const word = wrong.get(f)?.has(key) ? 'wrong field' : fix ? ERROR_WORD[fix.reason] ?? null : null;
        if (word) {
          const town = cols.municipality === undefined ? '' : String(r[cols.municipality] ?? '').trim();
          const id = `${f}\u0001${word}\u0001${v}\u0001${f === 'municipality' ? '' : town}`;
          const line = audit.get(id) ?? { field: PLACE_LABEL[f], reason: word, value: v, municipality: town, times: 0, byMonth: new Map<string, number>() };
          line.times++;
          if (m) line.byMonth.set(m.label, (line.byMonth.get(m.label) ?? 0) + 1);
          audit.set(id, line);
        }
        return word;
      });
      next.push(...flags, flags.filter(Boolean).length);
    }
    return { row: next, key: m?.key ?? Number.MAX_SAFE_INTEGER, at: entryTime(row, cols) ?? Number.MAX_SAFE_INTEGER };
  });
  built.sort((a, b) => a.key - b.key || a.at - b.at);
  return {
    headers: outHeaders, rows: built.map((b) => b.row), cols: outCols, added, monthFixed, workerFixed, trimmed,
    months: [...months].map(([label, key]) => ({ label, key })).sort((a, b) => a.key - b.key),
    audit: [...audit.values()].sort((a, b) => b.times - a.times || a.field.localeCompare(b.field) || a.value.localeCompare(b.value)),
  };
}

/* ---------- Counting ---------- */

export const PATIENT_TYPES = ['ER', 'ER/ED', 'OP', 'IP'] as const;
export const CLASSES = ['B', 'C1', 'C2', 'C3', 'N/A'] as const;
export const ERROR_FIELDS = ['barangayError', 'municipalityError', 'provinceError', 'regionError'] as const;

export interface MswdLine {
  name: string;
  total: number;
  types: number[];
  classes: number[];
  errors: number[];
  errorTotal: number;
  newPatients: number;
  oldPatients: number;
  rank: number;
}

export interface MswdBlock { label: string | null; title: string; lines: MswdLine[]; total: MswdLine; top: { name: string; count: number } }

export interface MswdCheck { level: 'good' | 'warn' | 'bad' | 'info'; title: string; detail?: string; items?: { label: string; count: number }[] }

export interface MswdReport {
  title: string;
  workers: string[];
  months: { label: string; key: number; partial?: string }[];
  blocks: MswdBlock[];
  rows: number;
  checks: MswdCheck[];
}

/** COUNTIFS compares text without regard to letter case and only matches text cells. */
const text = (v: RawCell) => (typeof v === 'string' ? v.toUpperCase() : null);
const filled = (v: RawCell) => typeof v === 'string' && v.length > 0;

function emptyLine(name: string): MswdLine {
  return { name, total: 0, types: [0, 0, 0, 0], classes: [0, 0, 0, 0, 0], errors: [0, 0, 0, 0], errorTotal: 0, newPatients: 0, oldPatients: 0, rank: 0 };
}

/** Workers in the order the report lists them: alphabetical, as in the original workbook. */
export function workerNames(p: Prepared): string[] {
  if (p.cols.worker === undefined) return [];
  const seen = new Map<string, string>();
  for (const r of p.rows) { const v = r[p.cols.worker]; if (typeof v === 'string' && v.trim()) { const k = v.toUpperCase(); if (!seen.has(k)) seen.set(k, v); } }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

export function computeReport(p: Prepared, workers: string[]): MswdReport {
  const c = p.cols;
  const index = new Map(workers.map((w, i) => [w.toUpperCase(), i]));
  const monthIndex = new Map(p.months.map((m, i) => [m.label.toUpperCase(), i]));
  const blocks = [...p.months.map((m) => m.label), null].map((label) => ({ label, lines: workers.map(emptyLine) }));
  const overall = blocks.length - 1;
  const ptype = PATIENT_TYPES.map((t) => t.toUpperCase());

  for (const r of p.rows) {
    const w = c.worker === undefined ? undefined : index.get(text(r[c.worker]) ?? '\u0000');
    if (w === undefined) continue;
    const m = c.month === undefined ? undefined : monthIndex.get(text(r[c.month]) ?? '\u0000');
    for (const b of m === undefined ? [overall] : [m, overall]) {
      const line = blocks[b].lines[w];
      line.total++;
      const t = c.typeOfPatient === undefined ? -1 : ptype.indexOf(text(r[c.typeOfPatient]) ?? '');
      if (t >= 0) line.types[t]++;
      const k = c.classification === undefined ? -1 : (CLASSES as readonly string[]).indexOf(text(r[c.classification]) ?? '');
      if (k >= 0) line.classes[k]++;
      ERROR_FIELDS.forEach((f, i) => { const col = c[f]; if (col !== undefined && filled(r[col])) line.errors[i]++; });
      if (c.totalErrors !== undefined && typeof r[c.totalErrors] === 'number') line.errorTotal += r[c.totalErrors] as number;
      const nt = c.patientType === undefined ? null : text(r[c.patientType]);
      if (nt === 'NEW') line.newPatients++;
      else if (nt === 'OLD') line.oldPatients++;
    }
  }

  const months: MswdReport['months'] = p.months.map((m, i) => (i === p.months.length - 1 ? { ...m, partial: partialDays(p, m.label) } : { ...m }));
  const last = months[months.length - 1];
  if (last && !last.partial) delete last.partial;
  const finished = blocks.map((b, i): MswdBlock => {
    const lines = b.lines;
    lines.forEach((l) => { l.rank = 1 + lines.filter((o) => o.total > l.total).length; });
    const total = emptyLine('TOTAL');
    for (const l of lines) {
      total.total += l.total; total.errorTotal += l.errorTotal; total.newPatients += l.newPatients; total.oldPatients += l.oldPatients;
      l.types.forEach((v, j) => { total.types[j] += v; });
      l.classes.forEach((v, j) => { total.classes[j] += v; });
      l.errors.forEach((v, j) => { total.errors[j] += v; });
    }
    const best = lines.reduce<MswdLine | null>((top, l) => (!top || l.total > top.total ? l : top), null);
    const label = i === overall ? null : b.label;
    return { label, title: label ?? 'OVERALL', lines, total, top: { name: best?.name ?? '', count: best?.total ?? 0 } };
  });
  return { title: reportTitle(months), workers, months, blocks: finished, rows: p.rows.length, checks: [] };
}

/** "1–14" when the last month's dates stop before the month ends. */
function partialDays(p: Prepared, label: string): string | undefined {
  const c = p.cols;
  const range = monthRange(label);
  if (!range || c.month === undefined) return undefined;
  const want = label.toUpperCase();
  let hi = 0;
  for (const r of p.rows) {
    if (text(r[c.month]) !== want) continue;
    const ms = rowDate(r, c);
    if (ms === null || ms < range.from || ms >= range.to + DAY) continue;
    hi = Math.max(hi, new Date(ms).getUTCDate());
  }
  if (!hi) return undefined;
  return hi < new Date(range.to).getUTCDate() ? `1${EN}${hi}` : undefined;
}

const spanOf = (months: { label: string }[]) => {
  const [first, last] = [months[0], months[months.length - 1]];
  const [fm, fy] = first.label.split(' ');
  const [lm, ly] = last.label.split(' ');
  return months.length === 1 ? first.label : fy === ly ? `${fm} to ${lm}${ly ? ` ${ly}` : ''}` : `${first.label} to ${last.label}`;
};

export function reportTitle(months: { label: string; partial?: string }[]): string {
  if (!months.length) return 'MSWD PERFORMANCE REPORT';
  const last = months[months.length - 1];
  return `MSWD PERFORMANCE REPORT  ${EM}  ${spanOf(months)}${last.partial ? ` (${last.label.split(' ')[0]} PARTIAL: ${last.partial})` : ''}`;
}

/** "OVERALL (JAN–OCT 2026)" */
export function overallLabel(months: { label: string }[]): string {
  if (!months.length) return 'OVERALL';
  const [first, last] = [months[0], months[months.length - 1]];
  const [fm, fy] = first.label.split(' ');
  const [lm, ly] = last.label.split(' ');
  const short = (m: string) => m.slice(0, 3);
  if (months.length === 1) return `OVERALL (${first.label})`;
  return fy === ly ? `OVERALL (${short(fm)}${EN}${short(lm)}${ly ? ` ${ly}` : ''})` : `OVERALL (${short(fm)} ${fy}${EN}${short(lm)} ${ly})`;
}

export const overallTitle = (months: { label: string }[]) => `MSWD PERFORMANCE ${EM} OVERALL TOTAL${months.length ? ` (${spanOf(months)})` : ''}`;

/* ---------- Match checks ---------- */

const tally = (rows: RawCell[][], pick: (r: RawCell[]) => string | null) => {
  const m = new Map<string, number>();
  for (const r of rows) { const k = pick(r); if (k !== null) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
};
const shown = (v: RawCell) => (v === null || v === undefined || v === '' ? '(blank)' : typeof v === 'object' ? new Date(v.date).toISOString().slice(0, 10) : String(v));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Proves that the report adds up, and lists every row that a column group could not count. */
export function checkReport(p: Prepared, report: MswdReport): MswdCheck[] {
  const c = p.cols;
  const checks: MswdCheck[] = [];
  const overall = report.blocks[report.blocks.length - 1];
  const known = new Set(report.workers.map((w) => w.toUpperCase()));
  const monthSet = new Set(report.months.map((m) => m.label.toUpperCase()));
  const isKnown = (r: RawCell[]) => c.worker !== undefined && known.has(text(r[c.worker]) ?? '\u0000');

  // 1. Every row is in the overall total exactly once, and the months add up to the overall total.
  const noWorker = p.rows.filter((r) => !isKnown(r));
  const sumMonths = report.blocks.slice(0, -1).reduce((n, b) => n + b.total.total, 0);
  const noMonth = p.rows.filter((r) => isKnown(r) && (c.month === undefined || !monthSet.has(text(r[c.month]) ?? '\u0000'))).length;
  if (overall.total.total + noWorker.length === p.rows.length && sumMonths + noMonth === overall.total.total) {
    checks.push({ level: 'good', title: `All ${p.rows.length.toLocaleString('en-US')} rows are counted once`, detail: `The months add up to the overall total of ${overall.total.total.toLocaleString('en-US')}${noWorker.length ? `, and ${plural(noWorker.length, 'row')} without a listed RSW ${noWorker.length === 1 ? 'is' : 'are'} left out` : ''}.` });
  } else {
    checks.push({ level: 'bad', title: 'The totals do not add up', detail: `Rows: ${p.rows.length}, overall total: ${overall.total.total}, months: ${sumMonths}.` });
  }
  if (noWorker.length) checks.push({ level: 'warn', title: `${plural(noWorker.length, 'row')} ${noWorker.length === 1 ? 'has' : 'have'} no RSW from the list`, detail: 'These rows are not counted for anyone.', items: tally(noWorker, (r) => shown(c.worker === undefined ? null : r[c.worker])).slice(0, 12) });
  if (noMonth) checks.push({ level: 'warn', title: `${plural(noMonth, 'row')} ${noMonth === 1 ? 'has' : 'have'} no month`, detail: 'They are counted in the overall total but in no month.' });

  // 2. Column groups that do not add up to the total, and why.
  const counted = p.rows.filter(isKnown);
  const group = (field: MswdField, allowed: readonly string[], name: string) => {
    if (c[field] === undefined) { checks.push({ level: 'warn', title: `No ${name} column was found`, detail: `The ${name} columns of the report are left at zero.` }); return; }
    const out = counted.filter((r) => !allowed.includes(text(r[c[field]!]) ?? '\u0000'));
    if (!out.length) checks.push({ level: 'good', title: `${name}: every row is ${allowed.join(', ')}` });
    else checks.push({ level: 'warn', title: `${name}: ${plural(out.length, 'row')} ${out.length === 1 ? 'is' : 'are'} not ${allowed.join(', ')}`, detail: `These rows are in TOTAL PATIENT CATERED but in none of the ${name} columns, so that group adds up to ${(overall.total.total - out.length).toLocaleString('en-US')}.`, items: tally(out, (r) => shown(r[c[field]!])).slice(0, 12) });
  };
  group('typeOfPatient', PATIENT_TYPES, 'Type of patient');
  group('classification', CLASSES, 'Classification');
  group('patientType', ['NEW', 'OLD'], 'Patient type');

  // 3. Month labels against dates. Rows encoded early in the next month are normal, so this is information only.
  if (c.month !== undefined && (c.date !== undefined || c.timestamp !== undefined)) {
    const late = tally(p.rows, (r) => {
      const ms = rowDate(r, c);
      const label = text(r[c.month!]);
      if (ms === null || !label) return null;
      const d = monthOf({ date: ms })!.label;
      return d === label || !monthSet.has(label) ? null : `${label} dated ${d}`;
    });
    const n = late.reduce((s, x) => s + x.count, 0);
    if (n) checks.push({ level: 'info', title: `${plural(n, 'row')} ${n === 1 ? 'is' : 'are'} dated in a different month`, detail: 'The Month column decides where a row is counted. These are usually entries encoded in the first days of the next month.', items: late.slice(0, 12) });
  }

  // 4. Duplicate rows.
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of p.rows) { const k = JSON.stringify(r); if (seen.has(k)) dupes++; else seen.add(k); }
  checks.push(dupes ? { level: 'warn', title: `${plural(dupes, 'row')} ${dupes === 1 ? 'is an exact copy' : 'are exact copies'} of another row`, detail: 'Copies are counted twice. Remove them from the source file if they were submitted by mistake.' } : { level: 'good', title: 'No row is an exact copy of another' });

  // 5. The error total agrees with the error flags.
  if (c.totalErrors !== undefined && ERROR_FIELDS.some((f) => c[f] !== undefined)) {
    const bad = p.rows.filter((r) => ERROR_FIELDS.filter((f) => c[f] !== undefined && filled(r[c[f]!])).length !== (typeof r[c.totalErrors!] === 'number' ? r[c.totalErrors!] : 0)).length;
    checks.push(bad ? { level: 'warn', title: `${plural(bad, 'row')} ${bad === 1 ? 'has' : 'have'} a place-name error total that does not match its error flags` } : { level: 'good', title: 'Place-name error totals match the error flags' });
  }

  // 6. Worker names that look like misspellings of another worker.
  const similar = workerChecks(p, report.workers).filter((w) => w.similarTo);
  if (similar.length) checks.push({ level: 'warn', title: `${plural(similar.length, 'RSW name')} may be misspelled`, detail: 'A misspelled name is counted as a separate worker. Correct the name in the source file, or switch the correction on under Entry corrections.', items: similar.map((w) => ({ label: `${w.name} (looks like ${w.similarTo})`, count: w.total })) });
  return checks;
}

/* ---------- Dashboard ---------- */

/** One row of DASHBOARD DATA: the day a patient was entered, by whom, and how. */
export interface DayEntry { day: number | null; worker: string | null; patientType: string | null; first: boolean; type: string | null; classification: string | null; service: string | null }

const label = (v: RawCell) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() || null : v === null || v === undefined ? null : shown(v));

/** Dashboard counts follow the Timestamp, as in the original workbook. `first` marks a worker's first patient of the day. */
export function dayEntries(p: Prepared): DayEntry[] {
  const c = p.cols;
  const seen = new Set<string>();
  return p.rows.map((r) => {
    const at = entryTime(r, c);
    const day = at === null ? null : dayOf(at);
    const worker = c.worker === undefined ? null : label(r[c.worker]);
    const key = `${worker?.toUpperCase()}|${day}`;
    const first = worker !== null && day !== null && !seen.has(key);
    if (first) seen.add(key);
    return {
      day, worker, first,
      patientType: c.patientType === undefined ? null : label(r[c.patientType])?.toUpperCase() ?? null,
      type: c.typeOfPatient === undefined ? null : label(r[c.typeOfPatient]),
      classification: c.classification === undefined ? null : label(r[c.classification]),
      service: c.service === undefined ? null : label(r[c.service]),
    };
  });
}

export interface Holiday { date: number; name: string; type: 'Regular' | 'Special non-working' }

/** Easter Sunday (Gregorian), used for Holy Week. */
function easter(year: number): number {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return Date.UTC(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

/** Holidays whose date is set by proclamation each year. Edit them on the DASHBOARD SETTINGS sheet when they change. */
const PROCLAIMED: Record<number, [number, number, string][]> = {
  2025: [[0, 29, 'Chinese New Year'], [3, 1, "Eid'l Fitr"], [5, 6, "Eid'l Adha"]],
  2026: [[1, 17, 'Chinese New Year'], [2, 20, "Eid'l Fitr"], [4, 27, "Eid'l Adha"]],
};

/** Regular and special non-working holidays in the Philippines. */
export function philippineHolidays(years: number[]): Holiday[] {
  const out: Holiday[] = [];
  for (const y of [...new Set(years)].sort()) {
    const at = (m: number, d: number) => Date.UTC(y, m, d);
    const e = easter(y);
    const lastMondayOfAugust = (() => { const end = new Date(Date.UTC(y, 7, 31)); return Date.UTC(y, 7, 31 - ((end.getUTCDay() + 6) % 7)); })();
    const list: [number, string, Holiday['type']][] = [
      [at(0, 1), "New Year's Day", 'Regular'],
      ...(PROCLAIMED[y] ?? []).map(([m, d, name]): [number, string, Holiday['type']] => [at(m, d), name, name === 'Chinese New Year' ? 'Special non-working' : 'Regular']),
      [e - 3 * DAY, 'Maundy Thursday', 'Regular'], [e - 2 * DAY, 'Good Friday', 'Regular'], [e - DAY, 'Black Saturday', 'Special non-working'],
      [at(3, 9), 'Araw ng Kagitingan', 'Regular'], [at(4, 1), 'Labor Day', 'Regular'], [at(5, 12), 'Independence Day', 'Regular'],
      [at(7, 21), 'Ninoy Aquino Day', 'Special non-working'], [lastMondayOfAugust, 'National Heroes Day', 'Regular'],
      [at(10, 1), "All Saints' Day", 'Special non-working'], [at(10, 2), "All Souls' Day", 'Special non-working'], [at(10, 30), 'Bonifacio Day', 'Regular'],
      [at(11, 8), 'Feast of the Immaculate Conception', 'Special non-working'], [at(11, 24), 'Christmas Eve', 'Special non-working'], [at(11, 25), 'Christmas Day', 'Regular'],
      [at(11, 30), 'Rizal Day', 'Regular'], [at(11, 31), 'Last Day of the Year', 'Special non-working'],
    ];
    for (const [date, name, type] of list) out.push({ date, name, type });
  }
  return out.sort((a, b) => a.date - b.date);
}

/** Mondays to Fridays from `from` to `to`, both included, minus holidays. Matches Excel's NETWORKDAYS. */
export function workingDays(from: number, to: number, holidays: number[]): number {
  if (to < from) return 0;
  const off = new Set(holidays.map(dayOf));
  let n = 0;
  for (let d = dayOf(from); d <= to; d += DAY) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6 && !off.has(d)) n++;
  }
  return n;
}

export interface WorkerPeriod { name: string; total: number; activeDays: number; newPatients: number; oldPatients: number }
export interface PeriodStats { from: number; to: number; total: number; activeWorkers: number; workerDays: number; workers: WorkerPeriod[] }

/** Patients, active days, and new or old patients for every worker between two days, both included. */
export function periodStats(entries: DayEntry[], workers: string[], from: number, to: number): PeriodStats {
  const index = new Map(workers.map((w, i) => [w.toUpperCase(), i]));
  const lines: WorkerPeriod[] = workers.map((name) => ({ name, total: 0, activeDays: 0, newPatients: 0, oldPatients: 0 }));
  let total = 0;
  let workerDays = 0;
  for (const e of entries) {
    if (e.day === null || e.day < from || e.day > to) continue;
    total++;
    if (e.first) workerDays++;
    const w = e.worker === null ? undefined : index.get(e.worker.toUpperCase());
    if (w === undefined) continue;
    const l = lines[w];
    l.total++;
    if (e.first) l.activeDays++;
    if (e.patientType === 'NEW') l.newPatients++;
    else if (e.patientType === 'OLD') l.oldPatients++;
  }
  return { from, to, total, activeWorkers: lines.filter((l) => l.total > 0).length, workerDays, workers: lines };
}

/* ---------- Data checks ---------- */

export interface MonthMismatch { row: number; label: string; stamp: number; byStamp: string; worker: string; hospitalNo: RawCell }

/** Rows whose Month label is not the month of their Timestamp. `row` is the row number on the MASTER DATA sheet. */
export function monthMismatches(p: Prepared): MonthMismatch[] {
  const c = p.cols;
  if (c.month === undefined || c.timestamp === undefined) return [];
  const out: MonthMismatch[] = [];
  p.rows.forEach((r, i) => {
    const stamp = toMs(r[c.timestamp!]);
    const given = text(r[c.month!]);
    if (stamp === null || !given) return;
    const byStamp = monthOf({ date: stamp })!.label;
    if (byStamp !== given) out.push({ row: i + 2, label: String(r[c.month!]), stamp, byStamp, worker: c.worker === undefined ? '' : String(r[c.worker] ?? ''), hospitalNo: c.hospitalNo === undefined ? null : r[c.hospitalNo] });
  });
  return out;
}

export interface WorkerCheck { name: string; total: number; first: number | null; last: number | null; months: number; surname: string; flag: string; similarTo?: string }

/** Worker name check: low counts, shared surnames, and names one typing slip away from another worker. */
export function workerChecks(p: Prepared, workers: string[], lowCount = 50): WorkerCheck[] {
  const c = p.cols;
  const index = new Map(workers.map((w, i) => [w.toUpperCase(), i]));
  const stats = workers.map((name) => ({ name, total: 0, first: null as number | null, last: null as number | null, months: new Set<string>() }));
  if (c.worker !== undefined) {
    for (const r of p.rows) {
      const w = index.get(text(r[c.worker]) ?? '\u0000');
      if (w === undefined) continue;
      const s = stats[w];
      s.total++;
      const at = entryTime(r, c);
      if (at !== null) { const d = dayOf(at); s.first = s.first === null ? d : Math.min(s.first, d); s.last = s.last === null ? d : Math.max(s.last, d); }
      const m = c.month === undefined ? null : text(r[c.month]);
      if (m) s.months.add(m);
    }
  }
  const surname = (n: string) => (n.includes(',') ? n.slice(0, n.indexOf(',')) : n).trim().toUpperCase();
  const surnames = new Map<string, number>();
  for (const w of workers) surnames.set(surname(w), (surnames.get(surname(w)) ?? 0) + 1);
  return stats.map((s) => {
    const key = variantKey(s.name);
    const twin = stats.find((o) => o !== s && o.total > s.total && (isLikelyTypo(key, variantKey(o.name)) || isSimilarEntry(key, variantKey(o.name))));
    // Same order as the formula on DATA CHECKS: the low-count note first.
    const flags = [
      s.total < lowCount ? 'Low patient count.' : '',
      twin ? `Possible misspelling of ${twin.name.replace(/\.$/, '')}.` : '',
      (surnames.get(surname(s.name)) ?? 0) > 1 ? 'Same surname as another worker; check spelling.' : '',
    ].filter(Boolean);
    return { name: s.name, total: s.total, first: s.first, last: s.last, months: s.months.size, surname: surname(s.name), flag: flags.join(' '), similarTo: twin?.name };
  });
}

/** The misspelling audit: lines found by this app, or read from the error columns already in the file. */
export function misspellingAudit(p: Prepared): AuditLine[] {
  if (p.audit.length) return p.audit;
  const c = p.cols;
  const audit = new Map<string, AuditLine>();
  for (const r of p.rows) {
    const m = c.month === undefined ? null : text(r[c.month]);
    PLACE_FIELDS.forEach((f, i) => {
      const flag = c[ERROR_FIELDS[i]] === undefined ? null : r[c[ERROR_FIELDS[i]]!];
      const col = c[f];
      if (!filled(flag) || col === undefined) return;
      const value = String(r[col] ?? '');
      const town = c.municipality === undefined ? '' : String(r[c.municipality] ?? '').trim();
      const id = `${f}\u0001${flag}\u0001${value}\u0001${f === 'municipality' ? '' : town}`;
      const line = audit.get(id) ?? { field: PLACE_LABEL[f], reason: String(flag), value, municipality: town, times: 0, byMonth: new Map<string, number>() };
      line.times++;
      if (m) line.byMonth.set(m, (line.byMonth.get(m) ?? 0) + 1);
      audit.set(id, line);
    });
  }
  return [...audit.values()].sort((a, b) => b.times - a.times || a.field.localeCompare(b.field) || a.value.localeCompare(b.value));
}

/* ---------- Comparing with an existing report ---------- */

export interface Mismatch { block: string; name: string; column: string; sheet: number | null; computed: number }

export const COLUMN_NAMES = ['TOTAL PATIENT CATERED', 'ER', 'ER/ED', 'OP', 'IP', 'B', 'C1', 'C2', 'C3', 'N/A', 'Barangay', 'Municipality', 'Province', 'Region', 'TOTAL', 'NEW', 'OLD'];
export const lineValues = (l: MswdLine) => [l.total, ...l.types, ...l.classes, ...l.errors, l.errorTotal, l.newPatients, l.oldPatients];

/**
 * Compares a "MSWD PERFORMANCE" sheet already in the uploaded workbook with the numbers computed from its data.
 * Blocks are found by their title, such as "MSWD PERFORMANCE - JANUARY 2026" or "OVERALL TOTAL".
 */
export function compareWithSheet(grid: RawCell[][], report: MswdReport): { checked: number; mismatches: Mismatch[]; blocks: number } {
  const mismatches: Mismatch[] = [];
  let checked = 0;
  let blocks = 0;
  const byLabel = new Map(report.blocks.map((b) => [(b.label ?? 'OVERALL').toUpperCase(), b]));
  for (let r = 0; r < grid.length; r++) {
    const title = typeof grid[r]?.[0] === 'string' ? (grid[r][0] as string).toUpperCase() : '';
    if (!/MSWD PERFORMANCE\s*[—–-]/.test(title)) continue;
    const block = /OVERALL/.test(title) ? byLabel.get('OVERALL') : [...byLabel.entries()].find(([k]) => k !== 'OVERALL' && title.includes(k))?.[1];
    if (!block) continue;
    blocks++;
    const lines = new Map(block.lines.map((l) => [l.name.toUpperCase(), l]));
    for (let k = r + 1; k < Math.min(grid.length, r + 6 + block.lines.length); k++) {
      const name = typeof grid[k]?.[0] === 'string' ? (grid[k][0] as string).trim().toUpperCase() : '';
      const line = lines.get(name);
      if (!line) continue;
      lineValues(line).forEach((computed, j) => {
        const v = grid[k][1 + j];
        const sheet = typeof v === 'number' ? v : v === null || v === undefined || v === '' ? null : Number(v);
        checked++;
        if (sheet !== computed && !(sheet === null && computed === 0)) mismatches.push({ block: block.title, name: line.name, column: COLUMN_NAMES[j], sheet: Number.isFinite(sheet as number) ? sheet : null, computed });
      });
    }
  }
  return { checked, mismatches, blocks };
}
