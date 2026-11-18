// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { Cell, Column, NumberFormat } from './types';

const SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', PHP: '₱', INR: '₹', CNY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$',
  '$': '$', '€': '€', '£': '£', '¥': '¥', '₱': '₱', '₹': '₹', '₩': '₩', '₫': '₫', '฿': '฿', RS: '₹', 'RS.': '₹',
};

export const currencySymbol = (c?: string) => (c ? SYMBOLS[c.toUpperCase()] ?? `${c} ` : '$');

function compact(v: number): string {
  const a = Math.abs(v);
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [u, s] of units) {
    if (a >= u) {
      const n = v / u;
      return `${n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 })}${s}`;
    }
  }
  return v.toLocaleString('en-US', { maximumFractionDigits: a < 10 && a % 1 !== 0 ? 2 : a < 100 ? 1 : 0 });
}

export interface FormatSpec { format?: NumberFormat; currency?: string; compact?: boolean; }

export function formatNumber(v: number | null | undefined, spec: FormatSpec = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const { format = 'number', currency } = spec;
  if (format === 'percent') return `${(v * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  const prefix = format === 'currency' ? currencySymbol(currency) : '';
  if (spec.compact && a >= 10000) return `${sign}${prefix}${compact(a)}`;
  if (spec.compact && Number.isInteger(a)) return `${sign}${prefix}${a.toLocaleString('en-US')}`;
  const digits = format === 'integer' ? { maximumFractionDigits: 0 }
    : format === 'currency' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: a >= 1000 ? 0 : a >= 1 ? 2 : 4 };
  return `${sign}${prefix}${a.toLocaleString('en-US', digits)}`;
}

export const formatPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export const formatDate = (ms: number) => {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
};

export function formatCell(v: Cell, c?: Column): string {
  if (v === null || v === undefined) return '';
  if (c?.type === 'date' && typeof v === 'number') return formatDate(v);
  if (typeof v === 'number') return c ? formatNumber(v, { format: c.format, currency: c.currency }) : String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
