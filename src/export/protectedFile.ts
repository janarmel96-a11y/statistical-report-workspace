// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { ReportDoc } from '../core/report';
import type { DataTable, LocaleOptions, RawCell, RawTable, Step } from '../core/types';
import type { CombineConfig } from '../state/persist';

/**
 * Role-protected report files. Each role has its own encrypted copy, so a viewer's passcode can
 * only ever open the copy that has personal and identifying columns physically removed.
 */

export type AccessRole = 'owner' | 'viewer';

export interface ProtectedProject {
  role: AccessRole;
  raws: RawTable[];
  combine: CombineConfig;
  locale: LocaleOptions;
  steps: Step[];
  disabledFindings: string[];
  report: ReportDoc;
}

interface Envelope { salt: string; iv: string; data: string }
interface ProtectedFile { app: 'statistical-report-workspace'; format: 'protected-report'; version: 1; iterations: number; envelopes: Envelope[] }

export const MIN_PASSCODE = 8;
const ITERATIONS = 310000;

const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(passcode: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(project: ProtectedProject, passcode: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(passcode, salt, ITERATIONS), new TextEncoder().encode(JSON.stringify(project)));
  return { salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

export async function buildProtectedFile(owner: ProtectedProject, ownerPasscode: string, viewer: ProtectedProject | null, viewerPasscode: string): Promise<string> {
  const envelopes = [await seal(owner, ownerPasscode)];
  if (viewer) envelopes.push(await seal(viewer, viewerPasscode));
  const file: ProtectedFile = { app: 'statistical-report-workspace', format: 'protected-report', version: 1, iterations: ITERATIONS, envelopes };
  return JSON.stringify(file);
}

/** Returns the copy this passcode unlocks, or null when the passcode is wrong. */
export async function openProtectedFile(text: string, passcode: string): Promise<ProtectedProject | null> {
  const file = JSON.parse(text) as ProtectedFile;
  if (file.format !== 'protected-report') throw new Error('This is not a protected report file.');
  for (const e of file.envelopes) {
    try {
      const key = await keyFrom(passcode, fromB64(e.salt), file.iterations);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv) }, key, fromB64(e.data));
      return JSON.parse(new TextDecoder().decode(plain)) as ProtectedProject;
    } catch { /* this passcode belongs to another copy */ }
  }
  return null;
}

const SENSITIVE_NAME = /(birth|\bdob\b|address|street|house no|barangay|\bbrgy\b|worker|\bstaff\b|encoder|signature)/i;

/** Columns a viewer must not receive: identifiers, free text, and details that can single out a person. */
export const sensitiveColumns = (t: DataTable) => t.columns.filter((c) => c.role === 'id' || c.role === 'text' || c.type === 'text' || SENSITIVE_NAME.test(c.name)).map((c) => c.name);

/** Builds the viewer's copy from corrected data, with sensitive columns removed entirely. */
export function viewerProject(t: DataTable, report: ReportDoc, locale: LocaleOptions): ProtectedProject {
  const hidden = new Set(sensitiveColumns(t));
  const kept = t.columns.filter((c) => !hidden.has(c.name));
  const raw: RawTable = {
    name: t.name, source: t.name, headers: kept.map((c) => c.name),
    rows: Array.from({ length: t.rowCount }, (_, r) => kept.map((c): RawCell => { const v = c.values[r]; return c.type === 'date' && typeof v === 'number' ? { date: v } : v; })),
  };
  const usable = (name: string) => !hidden.has(name);
  const pages = report.pages.map((p) => {
    const visuals = p.visuals.filter((v) => v.axis.every((a) => usable(a.col)) && (!v.legend || usable(v.legend.col)) && (!v.multiples || usable(v.multiples.col)) && v.values.every((x) => x.kind === 'measure' || x.agg === 'rows' || usable(x.col)));
    const ids = new Set(visuals.map((v) => v.id));
    return { ...p, visuals: visuals.map((v) => (v.values[0]?.kind === 'col' && v.values[0].agg === 'rows' ? { ...v, values: [{ ...v.values[0], col: kept[0]?.name ?? '' }] } : v)), layout: p.layout.filter((l) => ids.has(l.i)) };
  });
  const measures = report.measures.filter((m) => [...m.expr.matchAll(/\[([^\]]+)\]/g)].every((x) => usable(x[1].trim())));
  return {
    role: 'viewer', raws: [raw], combine: { mode: 'single' }, locale, steps: [], disabledFindings: [],
    report: { ...report, pages, measures, assistant: undefined, slicerFields: report.slicerFields.filter((f) => usable(f.col)), bookmarks: [] },
  };
}
