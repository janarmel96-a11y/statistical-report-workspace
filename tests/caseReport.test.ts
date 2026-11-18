// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import { askAssistant, emptyMemory } from '../src/core/assistant';
import { runAudit } from '../src/core/audit';
import { chooseTables } from '../src/core/autoReport';
import { Engine } from '../src/core/engine';
import { generateInsights, newReport, pickPlan } from '../src/core/insights';
import { inferColumn, inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import { queryCategories, queryKpi, queryRange, visualConstraints } from '../src/core/report';
import type { RawCell, RawTable, ValueRef } from '../src/core/types';

/** Invented case records with the same kinds of problems found in real form exports. */
const TOWNS = ['Alpha City', 'Bravo Town', 'Cedar Town', 'Delta City', 'Echo Town', 'Fern Town', 'Glen City'];
const headers = ['Timestamp', 'Score', 'Patient Status', 'Consent', 'Hospital No.', 'Case No.', 'Medical Social Worker', 'Patient Family Name', 'Patient First Name', 'Barangay', 'Municipality', 'Province', 'Birthday', 'Age', 'Sex', 'Contact Number', 'Civil Status', 'Classification', 'Service', 'Member ID Number'];
const on = Date.UTC(2026, 10, 10);

function record(i: number): RawCell[] {
  const age = 5 + (i * 7) % 80;
  const born = { date: Date.UTC(2026 - age, 0, 15) };
  return [{ date: on + (i % 17) * 86400000 }, 0, i % 3 ? 'Old' : 'New', i % 2 ? 'Yes' : 'No', `H-${10000 + i}`, 50000 + i, `Worker ${i % 4}`, `Family${i}`, `Given${i}`, `Barangay ${i % 25}`, TOWNS[i % 7], `Province ${i % 3}`, born, age, i % 5 < 3 ? 'Female' : 'Male', 9170000000 + i * 137, ['Married', 'Single', 'Widowed'][i % 3], ['C1', 'C2', 'C3'][i % 3], ['Medicine', 'Surgery', 'Pediatrics', 'OB'][i % 4], null];
}

const rows = Array.from({ length: 300 }, (_, i) => record(i));
const ageAt = headers.indexOf('Age');
rows[4][ageAt] = 9171234567;
rows[9][ageAt] = 'vi';
rows[20][ageAt] = '65`';
rows[33][ageAt] = 450;
rows[50][ageAt] = 700; rows[50][headers.indexOf('Birthday')] = 'unknown';

const raw: RawTable = { name: 'Form Responses 1', source: 'cases.xlsx', headers, rows };
const { table, inferred } = inferTable(raw);
const findings = runAudit(table, inferred);
const clean = applyRecipe(table, findings.filter((f) => f.auto).flatMap((f) => f.steps));
const en = new Engine(clean);
const report = newReport(en, 'Cases');
const col = (n: string) => clean.columns.find((c) => c.name === n)!;
const visuals = report.pages.flatMap((p) => p.visuals);
const records: ValueRef = pickPlan(en).metric!;

describe('reading record-style columns', () => {
  it.each(['Contact No.', 'Contact No', 'Contact #', 'Contact', 'Contact Numbers', 'CP No.', 'CP Number', 'Cellphone No.', 'Cell No', 'Mobile No.', 'Phone', 'Telephone Number', 'Tel. No.'])('%s is never an amount', (name) => {
    const c = inferColumn(name, [9171234567, 9181234567, 9191234567, 9201234567, 9211234567]).column;
    expect(c.role).toBe('id');
    expect(c.type).toBe('text');
  });
  it.each(['Age', 'AGE', 'Age (years)', 'Age in years', 'Patient Age'])('%s is corrected when impossible', (name) => {
    const rows = Array.from({ length: 12 }, (_, i) => [i === 3 ? 3100000 : 30 + i, { date: Date.UTC(1990, 0, 1) }, { date: Date.UTC(2026, 10, 1) }]);
    const t = inferTable({ name: 'a', source: 'a', headers: [name, 'Birthday', 'Visit Date'], rows });
    const fixed = applyRecipe(t.table, runAudit(t.table, t.inferred).filter((f) => f.auto).flatMap((f) => f.steps));
    expect(fixed.columns[0].values[3]).toBe(36);
  });
  it.each(['Contact Number', 'Hospital No.', 'Case No.', 'Member ID Number'])('%s is an identifier', (n) => {
    expect(col(n).role).toBe('id');
    expect(col(n).type).toBe('text');
  });
  it('keeps phone digits exactly', () => {
    expect(col('Contact Number').values[1]).toBe('9170000137');
    expect(inferColumn('Mobile', ['09171234567', 9181234567]).column.values).toEqual(['09171234567', '9181234567']);
  });
  it('treats personal names as private text', () => {
    expect(col('Patient Family Name').role).toBe('text');
    expect(col('Patient First Name').role).toBe('text');
  });
  it('does not mistake words that merely contain "age"', () => {
    expect(inferColumn('Wages', [1200.5, 1300, 1450]).column.role).toBe('measure');
    expect(inferColumn('Age', [30, 40, 50]).column.role).toBe('ratio');
  });
  it('still allows a real count column', () => {
    expect(inferColumn('Number of Children', [1, 2, 3, 2]).column.type).toBe('number');
  });
});

describe('impossible ages', () => {
  const f = findings.find((x) => x.kind === 'impossible-age')!;
  it('recalculates them from the birth date', () => {
    expect(f.count).toBe(5);
    const age = (i: number) => col('Age').values[i];
    expect(age(4)).toBe(5 + (4 * 7) % 80 - (new Date(on + 4 * 86400000).getUTCMonth() < 0 ? 1 : 0));
    expect(age(9)).toBe(5 + (9 * 7) % 80);
    expect(age(20)).toBe(5 + (20 * 7) % 80);
    expect(age(33)).toBe(5 + (33 * 7) % 80);
  });
  it('leaves out an age that cannot be recovered', () => {
    expect(col('Age').values[50]).toBeNull();
  });
  it('every remaining age is believable', () => {
    (col('Age').values.filter((v) => v !== null) as number[]).forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(120); });
  });
  it('does not report them as a separate unreadable-value problem', () => {
    expect(findings.some((x) => x.kind === 'invalid-value' && x.column === 'Age')).toBe(false);
  });
  it('groups ages in natural order', () => {
    const r = queryCategories(en, { col: 'Age Group' }, [records], []);
    expect(r.categories.filter((c) => c.key !== null).map((c) => c.label)).toEqual(['0-17', '18-29', '30-44', '45-59', '60 and over']);
    const ages = col('Age').values as (number | null)[];
    r.categories.forEach((c, i) => {
      if (c.key === '18-29') expect(r.series[0].data[i]).toBe(ages.filter((a) => a !== null && a >= 18 && a < 30).length);
      if (c.key === null) expect(r.series[0].data[i]).toBe(1);
    });
  });
});

describe('record reports', () => {
  it('counts records instead of adding columns', () => {
    const plan = pickPlan(en);
    expect(plan.caseMode).toBe(true);
    expect(records).toMatchObject({ kind: 'col', agg: 'rows' });
  });
  it('never charts identifiers, names, or constant values', () => {
    const used = visuals.flatMap((v) => [...v.axis.map((a) => a.col), ...(v.legend ? [v.legend.col] : []), ...v.values.flatMap((x) => (x.kind === 'col' && x.agg !== 'rows' ? [x.col] : []))]);
    ['Contact Number', 'Hospital No.', 'Case No.', 'Score', 'Patient Family Name', 'Patient First Name', 'Member ID Number', 'Medical Social Worker', 'Birthday'].forEach((n) => expect(used).not.toContain(n));
  });
  it('builds demographic and address pages', () => {
    expect(report.pages.map((p) => p.name)).toEqual(['Overview', 'Demographics', 'Location', 'Categories']);
    const titles = visuals.map((v) => v.title);
    ['Records by Sex', 'Records by Age Group', 'Records by Municipality', 'Top 10 by Barangay', 'Records by Province'].forEach((t) => expect(titles).toContain(t));
  });
  it('shows correct male and female counts', () => {
    const sex = col('Sex').values;
    const kpis = report.pages[0].visuals.filter((v) => v.type === 'kpi');
    expect(kpis.map((v) => v.title)).toEqual(['Total records', 'Female', 'Male', 'Age range (years)']);
    const value = (t: string) => { const v = kpis.find((x) => x.title === t)!; return queryKpi(en, v.values[0], visualConstraints(v, [])).value; };
    expect(value('Total records')).toBe(300);
    expect(value('Female')).toBe(sex.filter((s) => s === 'Female').length);
    expect(value('Male')).toBe(sex.filter((s) => s === 'Male').length);
    const ages = col('Age').values.filter((v) => v !== null) as number[];
    const r = queryRange(en, 'Age', [])!;
    expect([r.low, r.high]).toEqual([Math.min(...ages), Math.max(...ages)]);
    expect(r.label).toBe(`${Math.min(...ages)} to ${Math.max(...ages)}`);
    expect(r.high).toBeLessThanOrEqual(120);
    const bands = queryCategories(en, { col: 'Age Group' }, [records], []);
    const top = bands.categories.map((c, i) => ({ k: c.key, n: bands.series[0].data[i] as number })).filter((x) => x.k !== null).sort((a, b) => b.n - a.n)[0];
    expect(r.common?.label).toBe(top.k);
  });
  it('uses the event date, never the birthday, as the timeline', () => {
    expect(pickPlan(en).date).toBe('Timestamp');
  });
  it('writes findings about people, not phone numbers', () => {
    const text = generateInsights(en, []).map((i) => `${i.headline} ${i.text}`).join(' ');
    const female = col('Sex').values.filter((s) => s === 'Female').length / 300;
    expect(text).toContain(`Female accounts for ${(female * 100).toFixed(1)}% of all records`);
    expect(text).not.toMatch(/Contact Number|false leads|true leads/);
    expect(text).toContain('Ages range from');
    expect(text).not.toMatch(/\d[MBT]\b/);
  });
  it('the assistant counts by sex and address', () => {
    const ctx = { en, report, findings, cs: [], memory: emptyMemory() };
    const n = col('Sex').values.filter((s) => s === 'Female').length;
    expect(askAssistant('how many female', ctx).text).toContain(`There are ${n} rows for Female`);
    expect(askAssistant('top 3 municipality', ctx).table?.rows).toHaveLength(3);
  });
  it('business files still add up their amounts', () => {
    const biz = inferTable({ name: 'B', source: 'b', headers: ['Date', 'Region', 'Sales'], rows: Array.from({ length: 40 }, (_, i) => [`2026-01-${String((i % 27) + 1).padStart(2, '0')}`, ['N', 'S'][i % 2], 100 + i * 3]) }).table;
    expect(pickPlan(new Engine(biz))).toMatchObject({ caseMode: false, metric: { col: 'Sales', agg: 'sum' } });
  });
});

describe('automatic mode with related files', () => {
  const other: RawTable = { name: 'Form Responses 1', source: 'new cases.xlsx', headers: [...headers.filter((h) => h !== 'Civil Status'), 'Gender', 'Civil status'], rows: rows.slice(0, 20).map((r) => r) };
  it('uses both files even when a few headers differ', () => {
    const pick = chooseTables([raw, other]);
    expect(pick.tables).toHaveLength(2);
    expect(pick.combine.mode).toBe('append');
    expect(pick.skipped).toEqual([]);
  });
  it('still leaves out an unrelated sheet', () => {
    const lookup: RawTable = { name: 'Codes', source: 'codes.xlsx', headers: ['Code', 'Meaning'], rows: [['A', 'One']] };
    expect(chooseTables([raw, lookup]).skipped).toEqual(['Codes']);
  });
});
