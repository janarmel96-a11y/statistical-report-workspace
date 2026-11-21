import { describe, expect, it } from 'vitest';
import { analyzeReport, briefSections, briefText } from '../src/core/analyst';
import { detectRules, runAudit } from '../src/core/audit';
import { Engine } from '../src/core/engine';
import { checkReport, computeReport, detectColumns, prepare, workerNames } from '../src/core/mswd';
import { analyzeMswd } from '../src/core/mswdAnalyst';
import { inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import type { RawCell } from '../src/core/types';

/** All records below are invented. */
const engineOf = (headers: string[], rows: RawCell[][]) => {
  const { table, inferred } = inferTable({ name: 'Test', source: 'test.csv', headers, rows });
  const findings = runAudit(table, inferred);
  return { findings, en: new Engine(applyRecipe(table, findings.filter((f) => f.auto).flatMap((f) => f.steps))) };
};

describe('Analyst brief', () => {
  // 24 months of sales that grow steadily, with three branches of different size.
  const rows: RawCell[][] = [];
  for (let m = 0; m < 24; m++) {
    for (let k = 0; k < 30; k++) {
      const branch = ['North', 'South', 'East'][k % 3];
      const base = branch === 'North' ? 300 : branch === 'South' ? 200 : 100;
      rows.push([{ date: Date.UTC(2024, m, 1 + (k % 27)) }, branch, base + m * 12 + (k % 5) * 3]);
    }
  }
  const { en, findings } = engineOf(['Date', 'Branch', 'Sales'], rows);
  const b = analyzeReport(en, findings, []);

  it('finds the significant upward trend and says which test proves it', () => {
    expect(b.trend?.direction).toBe('up');
    expect(b.trend?.text).toMatch(/statistically significant upward trend \(Mann-Kendall p [<=]/);
  });
  it('forecasts the next three months with a 95% range', () => {
    expect(b.forecast?.labels).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026']);
    expect(b.forecast!.values[0]).toBeGreaterThan(b.forecast!.history[b.forecast!.history.length - 1].value);
    expect(b.forecast!.low[0]).toBeLessThan(b.forecast!.values[0]);
    expect(b.forecast!.high[0]).toBeGreaterThan(b.forecast!.values[0]);
  });
  it('names the strongest driver with an ANOVA effect size', () => {
    expect(b.drivers[0]).toMatchObject({ dim: 'Branch', level: 'strong' });
    expect(b.drivers[0].test).toMatch(/One-way ANOVA, F = [\d.]+, p < 0\.001, eta squared = 0\.\d+/);
    expect(b.drivers[0].text).toMatch(/^Branch explains \d+% of the differences in Sales: North averages/);
  });
  it('writes a headline, actions, a confidence level, and sections for downloads', () => {
    expect(b.headline).toMatch(/^Sales of .+, trending up, about .+ expected in Jan 2026\.$/);
    expect(b.actions.length).toBeGreaterThan(0);
    expect(b.confidence.level).toBe('high');
    expect(briefSections(b).map((s) => s.heading)).toEqual([
      b.headline, 'Key numbers', 'Performance by Branch', 'Distribution and outliers', 'What drives the numbers',
      'Risks and unusual results', 'Recommended actions', 'Confidence: high', 'How this was worked out',
    ]);
    expect(briefText(b)).toContain('Recommended actions:');
  });
  it('gives the key numbers an analyst would quote', () => {
    const labels = b.keyNumbers.map((k) => k.label);
    expect(labels).toEqual(['Total Sales', 'Average per month', 'Latest month (Dec 2025)', 'Same month last year', 'Best month', 'Lowest month', 'Forecast Jan 2026']);
    expect(b.keyNumbers[2]).toMatchObject({ tone: 'up', note: expect.stringMatching(/^Up [\d.]+% on Nov 2025$/) });
    expect(b.keyNumbers[3].note).toMatch(/^Dec 2025 is up \d+% year on year$/);
    expect(b.summary.some((s) => /Compared with the same month last year \(Dec 2024\), Dec 2025 is up/.test(s))).toBe(true);
  });
  it('ranks the segments with their share and growth', () => {
    expect(b.segments?.dim).toBe('Branch');
    expect(b.segments!.rows.map((r) => r.label)).toEqual(['North', 'South', 'East']);
    expect(b.segments!.rows[0].share).toBeGreaterThan(0.4);
    expect(b.segments!.growthLabel).toBe('Dec 2025 vs Nov 2025');
    expect(b.segments!.text[0]).toMatch(/^North leads Branch with .+ \(\d+% of Sales\)/);
  });
  it('describes the distribution and names the tests it used', () => {
    expect(b.distribution[0]).toMatch(/^Typical Sales is .+ \(median\); the middle half lies between .+ and .+, and the average is/);
    expect(b.methods.join(' ')).toMatch(/Mann-Kendall.*ANOVA.*IQR/s);
  });
  it('finds a real seasonal pattern, but not one made by steady growth', () => {
    expect(b.seasonality).toBeUndefined();
    const seasonal: RawCell[][] = [];
    for (let m = 0; m < 36; m++) {
      const month = m % 12;
      const n = 100 + 2 * m + (month === 11 ? 45 : month === 1 ? -30 : 0);
      for (let k = 0; k < n; k++) seasonal.push([{ date: Date.UTC(2023, m, 1 + (k % 27)) }, 'A']);
    }
    const r = analyzeReport(engineOf(['Date', 'Type'], seasonal).en, [], []);
    expect(r.seasonality).toMatch(/highest in December \(\d+% above normal\) and lowest in February \(\d+% below\)/);
  });
  it('finds relationships between numeric columns, and says they are not proof of cause', () => {
    const rows: RawCell[][] = Array.from({ length: 200 }, (_, i) => [1 + (i % 40), (1 + (i % 40)) * 9.5 + ((i * 37) % 120), 50 + (i % 13)]);
    const r = analyzeReport(engineOf(['Units', 'Revenue', 'Rating'], rows).en, [], []);
    expect(r.relationships[0].text).toBe('Units and Revenue rise and fall together (strong correlation). This shows they are linked, not that one causes the other.');
    expect(r.relationships[0].test).toMatch(/^Pearson r = 0\.[789]\d, Spearman rho/);
  });
  it('reports two columns that move almost exactly together only once', () => {
    const rows: RawCell[][] = Array.from({ length: 200 }, (_, i) => {
      const units = 1 + (i % 40);
      const gross = units * 9.5 + ((i * 37) % 120);
      return [units, gross, gross * 0.88];
    });
    const r = analyzeReport(engineOf(['Units', 'Gross Sales', 'Net Sales'], rows).en, [], []);
    expect(r.relationships.map((x) => x.text)).toEqual([
      'Net Sales moves almost exactly with Gross Sales, so it tells the same story; it is left out of the comparisons below.',
      'Units and Gross Sales rise and fall together (strong correlation). This shows they are linked, not that one causes the other.',
    ]);
  });

  it('flags an unusual month and a month still in progress', () => {
    const spiky: RawCell[][] = [];
    for (let m = 0; m < 14; m++) {
      const n = m === 8 ? 90 : 20;
      for (let k = 0; k < n; k++) spiky.push([{ date: Date.UTC(2025, m, 1 + (k % (m === 13 ? 9 : 27)), 9) + k * 1000 }, ['A', 'B'][k % 2]]);
    }
    const r = analyzeReport(engineOf(['Date', 'Type'], spiky).en, [], []);
    expect(r.risks.some((x) => /Unusual spike in Sep 2025/.test(x.text))).toBe(true);
    expect(r.risks.some((x) => /Feb 2026 is still in progress/.test(x.text))).toBe(true);
  });

  it('leaves dates with a wrong year out of the trend', () => {
    const typo: RawCell[][] = [];
    for (let m = 0; m < 10; m++) for (let k = 0; k < 40; k++) typo.push([{ date: Date.UTC(2026, m, 1 + (k % 27)) }, 'A']);
    typo.push([{ date: Date.UTC(1937, 4, 2) }, 'A'], [{ date: Date.UTC(2075, 1, 3) }, 'A']);
    const r = analyzeReport(engineOf(['Date of Service', 'Type'], typo).en, [], []);
    expect(r.summary[0]).toContain('from Jan 2026 to Oct 2026');
    expect(r.risks.some((x) => /2 rows have dates in Date of Service far outside the rest/.test(x.text))).toBe(true);
  });

  it('explains when there is nothing to analyze', () => {
    expect(analyzeReport(engineOf(['Note'], [['a'], ['b']]).en, [], []).confidence.level).toBe('low');
  });
});

describe('formula detection', () => {
  it('does not take a mostly empty column for a calculation', () => {
    // Errors are 0 on most rows, and so is Household ÷ Age, but the formula fails on every row with real errors.
    const rows: RawCell[][] = Array.from({ length: 400 }, (_, i) => [20 + (i % 50), i % 9 === 0 ? 4 : 0, i % 11 === 0 ? (i % 3) + 1 : 0]);
    const { table, inferred } = inferTable({ name: 'T', source: 't.csv', headers: ['Age', 'House Hold Size', 'Total Place-Name Errors'], rows });
    expect(detectRules(table, table.rowIds)).toEqual([]);
    expect(runAudit(table, inferred).some((f) => f.kind === 'wrong-calculation')).toBe(false);
  });
  it('still finds a real calculation with a few wrong rows', () => {
    const rows: RawCell[][] = Array.from({ length: 100 }, (_, i) => [1 + (i % 17), 2 + (i % 4), i === 7 ? 999 : (1 + (i % 17)) * (2 + (i % 4))]);
    const { table } = inferTable({ name: 'T', source: 't.csv', headers: ['Units', 'Price', 'Amount'], rows });
    expect(detectRules(table, table.rowIds).map((r) => r.label)).toEqual(['[Units] × [Price]']);
  });
  it('never changes the letters of a person\'s name', () => {
    const rows: RawCell[][] = [...Array.from({ length: 40 }, (): RawCell[] => ['AQUIÑO', 'x']), ['AQUINO', 'y'], ['  AQUINO,', 'z']];
    const { table, inferred } = inferTable({ name: 'T', source: 't.csv', headers: ['Patient Middle Name', 'Note'], rows });
    const fixed = applyRecipe(table, runAudit(table, inferred).filter((f) => f.auto).flatMap((f) => f.steps));
    const names = fixed.columns.find((c) => c.name === 'Patient Middle Name')!.values;
    expect(names.filter((v) => v === 'AQUINO')).toHaveLength(2);
  });
});

describe('MSWD analyst summary', () => {
  const headers = ['Month', 'Patient Type', 'Medical Social Worker', 'Type of Patient', 'Classification', 'Date and Time', 'Total Place-Name Errors'];
  const rows: RawCell[][] = [];
  const workers = ['ABAJAR, MARY JOY E.', 'BALAIROS, KYROSE B.', 'DIZON, MARK JOESAN A.', 'SALVADOR, MICHELLE A.'];
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY'];
  months.forEach((m, mi) => {
    workers.forEach((w, wi) => {
      // DIZON stops in the last complete month; SALVADOR makes many place-name errors.
      const n = mi === 6 ? 15 : wi === 2 && mi === 5 ? 0 : 60 + wi * 10 + mi;
      for (let k = 0; k < n; k++) rows.push([`${m} 2026`, k % 3 ? 'OLD' : 'NEW', w, k % 4 ? 'OP' : 'IP', 'C3', { date: Date.UTC(2026, mi, 1 + (k % (mi === 6 ? 10 : 28))) }, wi === 3 && k % 5 === 0 ? 1 : 0]);
    });
  });
  const cols = detectColumns(headers);
  const p = prepare(headers, rows, cols, []);
  const report = computeReport(p, workerNames(p));
  const brief = analyzeMswd(p, report, checkReport(p, report));
  const section = (h: string) => brief.sections.find((s) => s.heading === h)!.lines.join(' ');

  it('summarizes numbers, forecasts next month, and projects the partial month', () => {
    expect(brief.headline).toMatch(/^\d[\d,]* patients catered by 4 RSWs; June 2026 down on May 2026; about [\d,]+ expected next month\.$/);
    expect(section('Patient numbers')).toMatch(/Forecast for July 2026: about [\d,]+ patients \(95% range/);
    expect(section('Patient numbers')).toMatch(/July 2026 is partial \(days 1–10\): 60 patients in \d+ of \d+ working days\. At this pace it would end near [\d,]+\./);
  });
  it('gives key numbers and the data for its charts', () => {
    expect(brief.keyNumbers.map((k) => k.label)).toEqual(['Patients catered', 'Average per month', 'June 2026', 'Forecast July 2026', 'July 2026 so far', 'Top RSW overall']);
    expect(brief.keyNumbers[2]).toMatchObject({ tone: 'down', note: expect.stringMatching(/^Down \d+% on May 2026$/) });
    expect(brief.forecast!.labels).toEqual(['July 2026', 'August 2026', 'September 2026']);
    expect(brief.forecast!.history).toHaveLength(6);
    expect(brief.monthly.at(-1)).toMatchObject({ label: 'July 2026', partial: true });
    expect(brief.workload!.month).toBe('June 2026');
    expect(brief.workload!.rows.map((r) => r.label)).toEqual(['SALVADOR, MICHELLE A.', 'BALAIROS, KYROSE B.', 'ABAJAR, MARY JOY E.']);
    expect(brief.mix!.months[0]).toBe('January');
    expect(brief.mix!.newShare[0] + brief.mix!.oldShare[0]).toBeCloseTo(1, 6);
  });
  it('names the RSWs who need attention and the high error rate', () => {
    expect(section('RSWs to watch')).toContain('DIZON, MARK JOESAN A. recorded no patients in June 2026');
    expect(section('RSWs to watch')).toMatch(/SALVADOR, MICHELLE A\. has the most place-name errors: 20\.\d per 100 patients/);
    expect(section('Recommended actions')).toContain('to SALVADOR, MICHELLE A.');
    expect(section('Recommended actions')).not.toContain('A..');
  });
});
