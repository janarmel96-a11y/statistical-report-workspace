// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type {
  Cell, ColRole, ColType, Column, ColumnHint, DataTable, DateOrder, LocaleOptions, NumberFormat, RawCell, RawTable,
} from './types';
import { DEFAULT_LOCALE } from './types';

export const MISSING = new Set(['', '-', '--', '—', '–', 'na', 'n/a', 'n.a.', '#n/a', 'null', 'none', 'nil', 'nan', '?', 'tbd', 'missing', 'unknown value']);
export const SHEET_ERROR = /^#(DIV\/0!|REF!|VALUE!|NAME\?|NUM!|N\/A|NULL!|SPILL!|CALC!)$/i;

export const isMissingText = (s: string) => MISSING.has(s.trim().toLowerCase());

const CURRENCY = /[$€£¥₱₹₩₫฿]|\b(?:USD|EUR|GBP|JPY|PHP|INR|AUD|CAD|SGD|CNY)\b|\bRs\.?|\bPhp\b/gi;

export interface ParsedNumber { value: number; percent: boolean; currency?: string; decimals: number; }

/** Parses numbers as people write them: $1,234.50, (500), 1.234,56, 45%, 1 200, 12-, 3.4e5. */
export function parseNumber(input: string, locale: LocaleOptions['numberLocale'] = 'auto'): ParsedNumber | null {
  let s = input.trim();
  if (!s || s.length > 40) return null;
  let currency: string | undefined;
  const cur = s.match(CURRENCY);
  if (cur) { currency = cur[0].toUpperCase(); s = s.replace(CURRENCY, '').trim(); }
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  let percent = false;
  if (s.endsWith('%')) { percent = true; s = s.slice(0, -1).trim(); }
  if (/^[-−–]/.test(s)) { negative = !negative; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) s = s.slice(1).trim();
  else if (/[-−]$/.test(s)) { negative = !negative; s = s.slice(0, -1).trim(); }
  if (cur && /^[$€£¥₱₹₩₫฿]/.test(s)) s = s.slice(1);
  s = s.replace(/[\s  ']/g, '');
  if (!s || !/^[\d.,]*\d[\d.,]*(?:[eE][-+]?\d+)?$/.test(s)) return null;
  // Leading zeros mark codes such as 00123, keep those as text.
  if (/^0\d/.test(s) && !/[.,]/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalSep: '.' | ',' | null = null;
  if (locale === 'dot') decimalSep = '.';
  else if (locale === 'comma') decimalSep = ',';
  else if (lastDot >= 0 && lastComma >= 0) decimalSep = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0) {
    // 1,234 and 1,234,567 are thousands. 12,5 is a decimal comma.
    decimalSep = /^\d{1,3}(,\d{3})+$/.test(s) ? '.' : (s.match(/,/g)!.length === 1 ? ',' : '.');
  } else if (lastDot >= 0) {
    // 1.234.567 is thousands in comma locales, one dot is a decimal point.
    decimalSep = s.match(/\./g)!.length > 1 ? ',' : '.';
  } else decimalSep = '.';

  const group = decimalSep === '.' ? ',' : '.';
  const parts = s.split(group);
  if (parts.length > 1 && !parts.slice(1).every((p, i) => (i === parts.length - 2 ? /^\d{3}/.test(p) : /^\d{3}$/.test(p)))) return null;
  const norm = parts.join('').replace(decimalSep, '.');
  if ((norm.match(/\./g) ?? []).length > 1) return null;
  const v = Number(norm);
  if (!Number.isFinite(v)) return null;
  const decimals = norm.includes('.') && !/e/i.test(norm) ? norm.length - norm.indexOf('.') - 1 : 0;
  const scaled = percent ? v / 100 : v;
  return { value: negative ? -scaled : scaled, percent, currency, decimals };
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

function utc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1000 || y > 9999) return null;
  const t = Date.UTC(y, m, d, hh, mm, ss);
  const c = new Date(t);
  return c.getUTCMonth() === m && c.getUTCDate() === d ? t : null;
}

function timeOf(rest: string | undefined): [number, number, number] | null {
  if (!rest) return [0, 0, 0];
  const m = rest.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(am|pm)?\s*(?:z|utc|[-+]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  let h = +m[1];
  if (m[4]) { if (/pm/i.test(m[4]) && h < 12) h += 12; if (/am/i.test(m[4]) && h === 12) h = 0; }
  return h > 24 || +m[2] > 59 ? null : [h, +m[2], +(m[3] ?? 0)];
}

/** Returns UTC epoch ms, or null. `order` resolves day/month ambiguity in numeric dates. */
export function parseDate(input: string, order: Exclude<DateOrder, 'auto'> = 'mdy'): number | null {
  const s = input.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (s.length < 6 || s.length > 40) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](.+))?$/);
  if (m) { const t = timeOf(m[4]); return t && utc(+m[1], +m[2] - 1, +m[3], ...t); }
  m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return utc(+m[1], +m[2] - 1, 1);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?: (.+))?$/);
  if (m) {
    const t = timeOf(m[4]);
    if (!t) return null;
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    const dmy = order === 'dmy' ? a <= 31 && b <= 12 : a > 12;
    return dmy ? utc(y, b - 1, a, ...t) : utc(y, a - 1, b, ...t);
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ -]([a-z]{3,9})\.?[ -](\d{2,4})(?: (.+))?$/i);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) { const t = timeOf(m[4]); return t && utc(+m[3], MONTHS[m[2].toLowerCase()], +m[1], ...t); }
  m = s.match(/^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)? (\d{2,4})(?: (.+))?$/i);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) { const t = timeOf(m[4]); return t && utc(+m[3], MONTHS[m[1].toLowerCase()], +m[2], ...t); }
  m = s.match(/^([a-z]{3,9})\.?[ -](\d{4})$/i);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) return utc(+m[2], MONTHS[m[1].toLowerCase()], 1);
  m = s.match(/^(\d{4}) ?-? ?q([1-4])$/i) ?? null;
  if (m) return utc(+m[1], (+m[2] - 1) * 3, 1);
  m = s.match(/^q([1-4]) ?-? ?(\d{4})$/i);
  if (m) return utc(+m[2], (+m[1] - 1) * 3, 1);
  return null;
}

/** Decides day-first or month-first from values that can only be read one way. */
export function detectDateOrder(samples: string[]): { order: 'mdy' | 'dmy'; ambiguous: boolean } {
  let dmy = 0;
  let mdy = 0;
  let numeric = 0;
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    numeric++;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  if (dmy > mdy) return { order: 'dmy', ambiguous: false };
  if (mdy > dmy) return { order: 'mdy', ambiguous: false };
  return { order: 'mdy', ambiguous: numeric > 0 };
}

const ID_NAME = /(^|[\s_-])(id|ids|uuid|guid|code|sku|key|ref|reference|invoice|receipt|order[\s_-]?(no|num|number)|serial|zip|postal|phone|mobile|account|acct|ticket)($|[\s_-]|#)|(^|\s)(no\.?|#)$|Id$|ID$/;
const RATIO_NAME = /(%|percent|pct|ratio|rate|margin|share|average|avg|mean|median|score|index|per[\s_-]|growth|yield|utili[sz]ation|price|cost per|unit[\s_-]?(cost|price)|age|rating)/i;
const YEAR_NAME = /^(fiscal[\s_-]?)?(year|yr|fy|quarter|qtr|month|week|day|period)$/i;
const BOOL = new Map<string, boolean>([['true', true], ['false', false], ['yes', true], ['no', false], ['y', true], ['n', false]]);

export interface InferredColumn {
  column: Column;
  /** Cells that held a spreadsheet error such as #DIV/0!. */
  errorCells: number[];
  /** Number cells recovered from text, such as "$1,200". */
  convertedText: number[];
  /** Cells that could not be read as this column's type. */
  invalid: { row: number; text: string }[];
  ambiguousDates: boolean;
}

function roleFor(name: string, type: ColType, values: Cell[], format?: NumberFormat): ColRole {
  if (type === 'date') return 'date';
  if (type === 'text') return ID_NAME.test(name) ? 'id' : 'text';
  if (type === 'boolean') return 'dimension';
  if (type === 'category') return ID_NAME.test(name) ? 'id' : 'dimension';
  if (YEAR_NAME.test(name.trim())) return 'dimension';
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (ID_NAME.test(name) && nums.every(Number.isInteger)) return 'id';
  if (format === 'percent' || RATIO_NAME.test(name)) return 'ratio';
  // A strictly increasing integer sequence with every value unique is a row number.
  if (nums.length > 3 && nums.every(Number.isInteger) && new Set(nums).size === nums.length) {
    let up = true;
    for (let i = 1; i < nums.length && up; i++) up = nums[i] - nums[i - 1] === 1;
    if (up) return 'id';
  }
  return 'measure';
}

/** Detects a column's type and converts every cell, recording anything it had to repair. */
export function inferColumn(name: string, raw: RawCell[], hint?: ColumnHint, opts: LocaleOptions = DEFAULT_LOCALE, force?: ColType): InferredColumn {
  const errorCells: number[] = [];
  const present: { i: number; v: Exclude<RawCell, null> }[] = [];
  raw.forEach((v, i) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (SHEET_ERROR.test(v.trim())) { errorCells.push(i); return; }
      if (isMissingText(v)) return;
    }
    present.push({ i, v });
  });

  const texts = present.filter((p) => typeof p.v === 'string').map((p) => p.v as string);
  const dateDetect = opts.dateOrder === 'auto' || opts.dateOrder === 'ymd'
    ? detectDateOrder(texts.slice(0, 5000))
    : { order: opts.dateOrder, ambiguous: false };
  const order = dateDetect.order;

  let numHits = 0;
  let dateHits = 0;
  let boolHits = 0;
  let maxDecimals = 0;
  let percentHits = 0;
  let currency: string | undefined = hint?.currency;
  const sample = present.length > 20000 ? present.filter((_, i) => i % Math.ceil(present.length / 20000) === 0) : present;
  for (const { v } of sample) {
    if (typeof v === 'number') numHits++;
    else if (typeof v === 'object') dateHits++;
    else if (typeof v === 'boolean') boolHits++;
    else {
      const n = parseNumber(v, opts.numberLocale);
      if (n) { numHits++; if (n.percent) percentHits++; if (n.currency) currency ??= n.currency; }
      else if (parseDate(v, order) !== null) dateHits++;
      else if (BOOL.has(v.trim().toLowerCase())) boolHits++;
    }
  }
  const total = sample.length || 1;
  let type: ColType;
  if (force) type = force;
  else if (!present.length) type = 'category';
  else if (numHits / total >= 0.8) type = 'number';
  else if (dateHits / total >= 0.8) type = 'date';
  else if (boolHits / total >= 0.95) type = 'boolean';
  else {
    const distinct = new Set(present.map((p) => String(p.v).trim().toLowerCase())).size;
    const avgLen = present.slice(0, 500).reduce((s, p) => s + String(p.v).length, 0) / Math.min(500, present.length);
    type = (distinct <= 60 || distinct / present.length <= 0.5) && avgLen <= 60 ? 'category' : 'text';
  }

  const values: Cell[] = new Array(raw.length).fill(null);
  const convertedText: number[] = [];
  const invalid: { row: number; text: string }[] = [];
  for (const { i, v } of present) {
    if (type === 'number') {
      if (typeof v === 'number') {
        values[i] = v;
        const str = String(v);
        const dot = str.indexOf('.');
        if (dot >= 0 && !str.includes('e')) maxDecimals = Math.max(maxDecimals, Math.min(str.length - dot - 1, 6));
      } else if (typeof v === 'boolean') values[i] = v ? 1 : 0;
      else if (typeof v === 'object') invalid.push({ row: i, text: new Date(v.date).toISOString().slice(0, 10) });
      else {
        const n = parseNumber(v, opts.numberLocale);
        if (n) { values[i] = n.value; if (!/^-?\d+(\.\d+)?$/.test(v.trim())) convertedText.push(i); maxDecimals = Math.max(maxDecimals, Math.min(n.decimals + (n.percent ? 2 : 0), 6)); }
        else invalid.push({ row: i, text: v });
      }
    } else if (type === 'date') {
      if (typeof v === 'object') values[i] = v.date;
      else if (typeof v === 'string') {
        const d = parseDate(v, order);
        if (d !== null) values[i] = d; else invalid.push({ row: i, text: v });
      } else if (typeof v === 'number' && v > 20000 && v < 80000) {
        values[i] = Math.round((v - 25569) * 86400000); // Excel serial date stored as a plain number
      } else invalid.push({ row: i, text: String(v) });
    } else if (type === 'boolean') {
      if (typeof v === 'boolean') values[i] = v;
      else { const b = BOOL.get(String(v).trim().toLowerCase()); if (b === undefined) invalid.push({ row: i, text: String(v) }); else values[i] = b; }
    } else {
      values[i] = typeof v === 'object' ? new Date(v.date).toISOString().slice(0, 10) : String(v).trim();
    }
  }

  let format: NumberFormat | undefined;
  if (type === 'number') {
    const isInt = values.every((v) => v === null || Number.isInteger(v));
    format = hint?.format === 'percent' || percentHits / total > 0.5 ? 'percent'
      : hint?.format === 'currency' || currency ? 'currency'
      : isInt ? 'integer' : 'number';
  }
  const cleanName = name.trim();
  const column: Column = {
    name: cleanName, type, values, format, currency, decimals: type === 'number' ? maxDecimals : undefined,
    role: roleFor(cleanName, type, values, format),
  };
  return { column, errorCells, convertedText, invalid, ambiguousDates: type === 'date' && dateDetect.ambiguous };
}

/** Makes headers non-empty and unique so columns can be referenced by name. */
export function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = String(h ?? '').replace(/\s+/g, ' ').trim().replace(/[[\]]/g, '') || `Column ${i + 1}`;
    const key = base.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

export interface InferredTable { table: DataTable; inferred: InferredColumn[]; }

export function inferTable(raw: RawTable, opts: LocaleOptions = DEFAULT_LOCALE): InferredTable {
  const headers = uniqueHeaders(raw.headers);
  const inferred = headers.map((h, c) => inferColumn(h, raw.rows.map((r) => r[c] ?? null), raw.hints?.[c], opts));
  return {
    inferred,
    table: {
      name: raw.name,
      columns: inferred.map((i) => i.column),
      rowCount: raw.rows.length,
      rowIds: raw.rows.map((_, i) => i),
    },
  };
}
