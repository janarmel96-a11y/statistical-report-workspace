import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/core/audit';
import { inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import { listFixes, planCleanup, FULL_CLEANUP, variantKey } from '../src/core/cleanup';
import { codeFor, computeReport, detectColumns, planEntryCleanup, prepare, workerNames } from '../src/core/mswd';
import { isSimilarEntry } from '../src/core/typos';
import { isMswdUpload } from '../src/core/mswdSources';
import type { RawCell, RawTable } from '../src/core/types';

const key = (s: string) => variantKey(s);

describe('similar entries', () => {
  it.each([
    ['BAROTAC NUEBO', 'BAROTAC NUEVO'],
    ['ILOILI', 'ILOILO'],
    ['BAROTCA NEUVO', 'BAROTAC NUEVO'],
    ['TABUCSUBA', 'TABUC SUBA'],
    ['DUE?AS', 'DUENAS'],
    ['STA. BARBARA', 'SANTA BARBARA'],
    ['POB. NORTE', 'POBLACION NORTE'],
    ['BRGY. CAGUYUMAN', 'CAGUYUMAN'],
    ['SALVADOR, MICHELLE', 'SALVADOR, MICHELLE A.'],
    ['MICHELLE A. SALVADOR', 'SALVADOR, MICHELLE A.'],
    ['ZARRAGA', 'SARRAGA'],
  ])('%s is similar to %s', (a, b) => expect(isSimilarEntry(key(a), key(b))).toBe(true));

  it.each([
    ['BAGO', 'BATO'],
    ['BALISAN', 'BALASAN'],
    ['BALISANES', 'BALASANES'],
    ['CALINOG', 'CABATUAN'],
    ['BAROTAC VIEJO', 'BAROTAC NUEVO'],
    ['SAN JOSE', 'SAN JUAN'],
    ['REGION VI', 'REGION VII'],
    ['WARD 12', 'WARD 21'],
    ['MONITOR 24', 'MONITOR 27'],
    ['MALE', 'FEMALE'],
    ['SANTOS, MARIA A.', 'SANTOS, MARIA B.'],
    ['DELEONIO, RUSSEL LYNN B.', 'DELEONIO, RUSSEL MAY B.'],
    ['NORTH TOWN', 'SOUTH TOWN'],
    ['POBLACION A', 'POBLACION'],
    ['MERCED N', 'MERCED'],
    ['TALIBONG I', 'TALIBONG'],
    ['SALVADOR, MICHELLE A.', 'SALVADOR, MICHELLE'],
  ])('%s stays separate from %s', (a, b) => expect(isSimilarEntry(key(a), key(b))).toBe(false));

  it('corrects a similar spelling only when the right spelling is far more common', () => {
    const counts = new Map([['BAROTAC NUEVO', 90], ['BAROTAC NUEBO', 2], ['STA. BARBARA', 1], ['SANTA BARBARA', 40], ['TABUCSUBA', 3], ['TABUC SUBA', 100]]);
    const fixes = listFixes(counts, planCleanup(counts, FULL_CLEANUP));
    expect(fixes.map((f) => [f.from, f.to, f.reason])).toEqual([
      ['TABUCSUBA', 'TABUC SUBA', 'similar spelling'],
      ['BAROTAC NUEBO', 'BAROTAC NUEVO', 'similar spelling'],
      ['STA. BARBARA', 'SANTA BARBARA', 'similar spelling'],
    ]);
    // Only 10 times more common: not enough evidence for a similar spelling, so both stay.
    const close = new Map([['BAROTAC NUEVO', 20], ['BAROTAC NUEBO', 2]]);
    expect(listFixes(close, planCleanup(close, FULL_CLEANUP))).toEqual([]);
  });

  it('does not guess when an entry is similar to two common entries', () => {
    const counts = new Map([['SANTOS, MARIA A.', 60], ['SANTOS, MARIA B.', 60], ['SANTOS, MARIA', 1]]);
    expect(listFixes(counts, planCleanup(counts, FULL_CLEANUP))).toEqual([]);
  });
});

describe('similar spellings in the main workspace', () => {
  it('corrects them during the automatic checks, as a misspelling that can be switched off', () => {
    const pick = (i: number, list: [string, number][]) => { let at = i; for (const [v, n] of list) { if (at < n) return v; at -= n; } return null; };
    const rows: RawCell[][] = Array.from({ length: 140 }, (_, i) => [`R${i}`, pick(i, [['BAROTAC NUEVO', 100], ['BAROTAC NUEBO', 2], ['DUMANGAS', 37], ['DUMANGAS ', 1]])]);
    const { table, inferred } = inferTable({ name: 'Test', source: 'test.csv', headers: ['Ref', 'Town'], rows });
    const findings = runAudit(table, inferred);
    const f = findings.find((x) => x.title.includes('misspelled'))!;
    expect(f).toMatchObject({ column: 'Town', count: 2, auto: true });
    const town = applyRecipe(table, findings.filter((x) => x.auto).flatMap((x) => x.steps)).columns.find((c) => c.name === 'Town')!;
    expect(town.values.filter((v) => v === 'BAROTAC NUEVO')).toHaveLength(102);
    expect(town.values.filter((v) => v === 'DUMANGAS')).toHaveLength(38);
  });
});

describe('recognizing MSWD uploads', () => {
  const t = (headers: string[], name = 'Form Responses 1'): RawTable => ({ name, source: `${name}.xlsx`, headers, rows: [headers.map(() => 'x')] });
  it('sends the NEW and OLD patient responses to the MSWD report', () => {
    expect(isMswdUpload([t(['Timestamp', 'Patient Status', 'Medical Social Worker', 'Type of Patient', 'Classification'])])).toBe(true);
    expect(isMswdUpload([t(['Month', 'Patient Type', 'Medical Social Worker', 'Classification'], 'MASTER DATA'), t(['Date', 'Medical Social Worker'], 'DASHBOARD DATA')])).toBe(true);
  });
  it('leaves other files with a social worker column to the normal report', () => {
    expect(isMswdUpload([t(['Date', 'Medical Social Worker', 'Patients Catered'])])).toBe(false);
    expect(isMswdUpload([t(['Region', 'Sales', 'Units'])])).toBe(false);
  });
});

describe('wrong entries in the coded MSWD columns', () => {
  it.each([
    ['typeOfPatient', 'OPD', 'OP'], ['typeOfPatient', 'Out Patient', 'OP'], ['typeOfPatient', 'out-patient', 'OP'], ['typeOfPatient', 'ER-ED', 'ER/ED'],
    ['typeOfPatient', 'In Patient', 'IP'], ['classification', 'C-3', 'C3'], ['classification', 'Class C2', 'C2'], ['classification', 'NA', 'N/A'],
    ['classification', 'C III', 'C3'], ['patientStatus', 'New Patient', 'NEW'], ['patientType', 'OLD CASE', 'OLD'],
  ] as const)('%s: %s means %s', (field, value, code) => expect(codeFor(field, value)).toBe(code));

  it.each([['typeOfPatient', 'WITH ACTIVE PHILHEALTH'], ['classification', 'C4'], ['patientStatus', 'Case Closed']] as const)('%s: %s is left alone', (field, value) => expect(codeFor(field, value)).toBeNull());

  it('counts wrong entries in the right column after correcting them', () => {
    const headers = ['Month', 'Medical Social Worker', 'Patient Status', 'Type of Patient', 'Classification'];
    const rows: RawCell[][] = [
      ...Array.from({ length: 30 }, (): RawCell[] => ['JANUARY 2026', 'A', 'New', 'OP', 'C3']),
      ['JANUARY 2026', 'A', 'New Patient', 'OPD', 'C-3'],
      ['JANUARY 2026', 'A', 'Old', 'Out Patient', 'NA'],
      ['JANUARY 2026', 'A', 'Case Closed', 'WITH ACTIVE PHILHEALTH', 'C3'],
    ];
    const cols = detectColumns(headers);
    const plan = planEntryCleanup(headers, rows, cols);
    const status = plan.find((p) => p.name === 'Patient Status')!;
    expect(status.fixes).toEqual([{ from: 'New Patient', to: 'New', reason: 'wrong entry', count: 1 }]);
    const p = prepare(headers, rows, cols, plan);
    const line = computeReport(p, workerNames(p)).blocks[0].lines[0];
    expect(line).toMatchObject({ total: 33, types: [0, 0, 32, 0], classes: [0, 0, 0, 32, 1], newPatients: 31, oldPatients: 1 });
  });
});
