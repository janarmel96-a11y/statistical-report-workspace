// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
/** Shared data model. Everything in src/core is free of browser APIs so it can be unit tested. */

export type Cell = number | string | boolean | null;
export type ColType = 'number' | 'date' | 'category' | 'text' | 'boolean';
/** How a column may be aggregated. `ratio` and `id` must never be summed by default. */
export type ColRole = 'measure' | 'ratio' | 'id' | 'dimension' | 'date' | 'text';
export type NumberFormat = 'number' | 'integer' | 'currency' | 'percent';

export interface Column {
  name: string;
  type: ColType;
  role: ColRole;
  /** number: JS number, date: UTC epoch ms, category/text: string, boolean: boolean */
  values: Cell[];
  format?: NumberFormat;
  currency?: string;
  /** Decimal places seen in the source, used when rewriting corrected values. */
  decimals?: number;
}

export interface DataTable {
  name: string;
  columns: Column[];
  rowCount: number;
  /** Source row number (0-based, data rows only) for every current row. */
  rowIds: number[];
}

/** A table straight from a file, before any type detection. */
export interface RawTable {
  name: string;
  source: string;
  headers: string[];
  rows: RawCell[][];
  /** Per-column number format hints from spreadsheet cells. */
  hints?: (ColumnHint | undefined)[];
  /** 0..1 confidence for PDF and OCR extraction. */
  confidence?: number;
  note?: string;
}

export type RawCell = string | number | boolean | null | { date: number };

export interface ColumnHint {
  format?: NumberFormat;
  currency?: string;
}

export type DateOrder = 'auto' | 'mdy' | 'dmy' | 'ymd';
export type NumberLocale = 'auto' | 'dot' | 'comma';

export interface LocaleOptions {
  dateOrder: DateOrder;
  numberLocale: NumberLocale;
}

export const DEFAULT_LOCALE: LocaleOptions = { dateOrder: 'auto', numberLocale: 'auto' };

export type FillStrategy = 'zero' | 'mean' | 'median' | 'mode' | 'forward' | 'value';

export type Step =
  | { op: 'setType'; col: string; type: ColType }
  | { op: 'setRole'; col: string; role: ColRole }
  | { op: 'rename'; col: string; name: string }
  | { op: 'drop'; col: string }
  | { op: 'fill'; col: string; strategy: FillStrategy; value?: Cell }
  | { op: 'dropMissing'; col: string }
  | { op: 'merge'; cols: string[]; sep: string; name: string; keep?: boolean }
  | { op: 'split'; col: string; sep: string; names: string[] }
  | { op: 'dedupe' }
  | { op: 'replace'; col: string; from: Cell; to: Cell }
  | { op: 'excludeRows'; rows: number[]; reason: string }
  | { op: 'setCells'; col: string; changes: { row: number; value: Cell }[]; reason: string };

export type Severity = 'error' | 'warning' | 'info';

export interface CellChange {
  row: number;
  column: string;
  before: Cell;
  after: Cell;
  reason: string;
}

export interface Finding {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  column?: string;
  /** Number of affected rows or cells. */
  count: number;
  /** Steps that fix the problem. Empty when the finding is advisory. */
  steps: Step[];
  /** True when the fix is safe enough to apply without asking. */
  auto: boolean;
  changes: CellChange[];
}

export type DatePart = 'year' | 'quarter' | 'month' | 'week' | 'day';

export interface FieldRef {
  col: string;
  part?: DatePart;
}

export type Agg =
  | 'sum' | 'avg' | 'median' | 'min' | 'max' | 'count' | 'distinct' | 'stdev' | 'rows';

export type ValueRef =
  | { kind: 'col'; col: string; agg: Agg }
  | { kind: 'measure'; name: string };

export type Constraint =
  | { col: string; kind: 'in'; part?: DatePart; values: Cell[]; group?: boolean }
  | { col: string; kind: 'notIn'; part?: DatePart; values: Cell[]; group?: boolean }
  | { col: string; kind: 'range'; min: number; max: number; group?: boolean }
  | { col: string; kind: 'pred'; key: string; test: (row: number) => boolean };

export interface Measure {
  name: string;
  expr: string;
  format?: NumberFormat;
}

export interface Parameter {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}
