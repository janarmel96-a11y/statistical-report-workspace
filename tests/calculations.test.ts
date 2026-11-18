import { describe, expect, it } from 'vitest';
import golden from './golden/golden.json';
import { Engine, groupConstraint } from '../src/core/engine';
import { parseMeasure, validateMeasure } from '../src/core/measures';
import { inferTable } from '../src/core/parse';
import { queryCategories, queryKpi, queryVariance, visualTable, type Visual } from '../src/core/report';
import * as S from '../src/core/stats';
import type { Column, DataTable, FieldRef, Measure, ValueRef } from '../src/core/types';

/** Every expected value here was produced independently by NumPy, SciPy, and pandas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = golden as any;
const close = (a: number | null | undefined, b: number, digits = 8) => {
  expect(a).not.toBeNull();
  const tol = Math.max(Math.abs(b) * 10 ** -digits, 1e-9);
  expect(Math.abs((a as number) - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
};

const sales: number[] = G.rows.Sales;
const groupsBy = (k: string) => sales.filter((_, i) => G.rows.Region[i] === k);

describe('statistics match SciPy and NumPy', () => {
  const st = G.stats;
  it('descriptive statistics', () => {
    close(S.sum(sales), st.sum); close(S.mean(sales), st.mean); close(S.variance(sales), st.var); close(S.stdev(sales), st.std);
    close(S.median(sales), st.median); close(S.quantile(sales, 0.1), st.p10); close(S.quantile(sales, 0.9), st.p90);
    close(S.quantile(sales, 0.25), st.q1); close(S.quantile(sales, 0.75), st.q3); close(S.skewness(sales), st.skew); close(S.kurtosis(sales), st.kurt);
  });
  it('confidence interval and outliers', () => {
    const ci = S.meanCI(sales)!;
    close(ci.low, st.ci[0], 7); close(ci.high, st.ci[1], 7);
    expect(S.iqrOutliers(sales).indices.length).toBe(st.iqrOutliers);
    expect(S.modifiedZOutliers(sales).length).toBe(st.madOutliers);
  });
  it('correlation', () => {
    const pairs = sales.map((s, i) => [s, G.rows.Cost[i]]).filter((p) => p[1] !== null) as number[][];
    const [x, y] = [pairs.map((p) => p[0]), pairs.map((p) => p[1])];
    close(S.pearson(x, y).r, st.pearson[0]);
    close(S.spearman(x, y).r, st.spearman[0]);
  });
  it('group tests', () => {
    const [n, so, e, w] = ['North', 'South', 'East', 'West'].map(groupsBy);
    const t = S.welchT(n, so);
    close(t.statistic, st.welch[0]); close(t.p, st.welch[1], 6); close(t.df as number, st.welch[2]);
    const u = S.mannWhitney(n, so);
    close(u.statistic, st.mannwhitney[0]); close(u.p, st.mannwhitney[1], 6);
    const a = S.anova([n, so, e, w]);
    close(a.statistic, st.anova[0]); close(a.p, st.anova[1], 6);
    const h = S.kruskalWallis([n, so, e, w]);
    close(h.statistic, st.kruskal[0]); close(h.p, st.kruskal[1], 6);
    const c = S.chiSquare(st.crosstab);
    close(c.statistic, st.chi2[0]); close(c.p, st.chi2[1], 6); expect(c.df).toBe(st.chi2[2]);
  });
  it('trend test and false discovery rate', () => {
    const mk = S.mannKendall(st.monthly);
    close(mk.s, st.mannKendall.s); close(mk.z, st.mannKendall.z); close(mk.p, st.mannKendall.p, 6);
    S.benjaminiHochberg(st.bhInput).forEach((v, i) => close(v, st.bh[i]));
  });
});

function goldenTable(): DataTable {
  const r = G.rows;
  const keys = Object.keys(r);
  const raw = { name: 'Golden', source: 'golden', headers: keys, rows: r.Date.map((_: string, i: number) => keys.map((k) => r[k][i])) };
  return inferTable(raw).table;
}

describe('report engine matches pandas', () => {
  const t = goldenTable();
  const sum: ValueRef = { kind: 'col', col: 'Sales', agg: 'sum' };
  const month: FieldRef = { col: 'Date', part: 'month' };
  const key = (ms: number) => new Date(ms).toISOString().slice(0, 7);
  const measures: Measure[] = [
    { name: 'Share', expr: 'DIVIDE(SUM([Sales]), CALCULATE(SUM([Sales]), ALL([Region])))' },
    { name: 'Pct', expr: 'PCTOFTOTAL(SUM([Sales]))' },
    { name: 'Running', expr: 'RUNNINGSUM(SUM([Sales]), [Date])' },
    { name: 'MA3', expr: 'MOVINGAVG(SUM([Sales]), [Date], 3)' },
    { name: 'YoY', expr: 'DIVIDE(SUM([Sales]) - PREVIOUSYEAR(SUM([Sales])), PREVIOUSYEAR(SUM([Sales])))' },
    { name: 'Prev', expr: 'PREVIOUSPERIOD(SUM([Sales]))' },
    { name: 'YTD', expr: 'YTD(SUM([Sales]))' },
    { name: 'Margin', expr: 'DIVIDE(SUM([Sales]) - SUM([Cost]), SUM([Sales]))' },
    { name: 'RowMath', expr: 'SUM([Units] * [Price])' },
    { name: 'North', expr: 'SUMIF([Sales], [Region] = "North")' },
    { name: 'NorthCalc', expr: 'CALCULATE(SUM([Sales]), [Region] = "North")' },
    { name: 'Large', expr: 'COUNTIF([Sales] > 500)' },
    { name: 'AvgBiz', expr: 'AVERAGEIF([Sales], [Segment] = "Business")' },
    { name: 'Regions', expr: 'DISTINCTCOUNT([Region])' },
    { name: 'P90', expr: 'PERCENTILE([Sales], 0.9)' },
    { name: 'Nested', expr: '[Margin] * 100' },
  ];
  const en = new Engine(t, measures);
  const m = (name: string): ValueRef => ({ kind: 'measure', name });
  const atMonth = (k: number) => [groupConstraint(month, k)];
  const months = [...en.groupRows([], month).keys()] as number[];

  it('detects column types and roles', () => {
    const byName = Object.fromEntries(t.columns.map((c: Column) => [c.name, c]));
    expect(byName.Date.type).toBe('date');
    expect(byName.Sales.role).toBe('measure');
    expect(byName.Price.role).toBe('ratio');
    expect(byName.Region.type).toBe('category');
  });
  it('aggregates by group', () => {
    for (const [k, v] of Object.entries<number>(G.query.byRegion)) close(en.evaluate(sum, [groupConstraint({ col: 'Region' }, k)]), v);
    for (const [k, v] of Object.entries<number>(G.query.avgByRegion)) close(en.evaluate({ kind: 'col', col: 'Sales', agg: 'avg' }, [groupConstraint({ col: 'Region' }, k)]), v);
    for (const [k, v] of Object.entries<number>(G.query.medianByRegion)) close(en.evaluate({ kind: 'col', col: 'Sales', agg: 'median' }, [groupConstraint({ col: 'Region' }, k)]), v);
    for (const [k, v] of Object.entries<number>(G.query.countCost)) expect(en.evaluate({ kind: 'col', col: 'Cost', agg: 'count' }, [groupConstraint({ col: 'Region' }, k)])).toBe(v);
  });
  it('percent of total', () => {
    for (const [k, v] of Object.entries<number>(G.query.shareByRegion)) {
      close(en.evaluate(m('Share'), [groupConstraint({ col: 'Region' }, k)]), v);
      close(en.evaluate(m('Pct'), [groupConstraint({ col: 'Region' }, k)]), v);
    }
  });
  it('monthly and quarterly buckets', () => {
    expect(months.length).toBe(Object.keys(G.query.byMonth).length);
    months.forEach((k) => close(en.evaluate(sum, atMonth(k)), G.query.byMonth[key(k)]));
    const q = queryCategories(en, { col: 'Date', part: 'quarter' }, [sum], []);
    q.categories.forEach((c, i) => close(q.series[0].data[i], G.query.byQuarter[c.label]));
  });
  it('running total and moving average', () => {
    months.forEach((k) => {
      close(en.evaluate(m('Running'), atMonth(k)), G.query.running[key(k)]);
      close(en.evaluate(m('MA3'), atMonth(k)), G.query.ma3[key(k)]);
    });
  });
  it('time intelligence', () => {
    let yoyChecked = 0;
    months.forEach((k) => {
      const y = G.query.yoy[key(k)];
      if (y !== undefined) { close(en.evaluate(m('YoY'), atMonth(k)), y); yoyChecked++; }
      const p = G.query.previousMonth[key(k)];
      if (p !== undefined) close(en.evaluate(m('Prev'), atMonth(k)), p);
    });
    expect(yoyChecked).toBeGreaterThan(20);
    Object.entries<number>(G.query.ytd2023).forEach(([k, v]) => close(en.evaluate(m('YTD'), atMonth(Date.parse(`${k}-01T00:00:00Z`))), v));
  });
  it('filters combine correctly', () => {
    const cs = [groupConstraint({ col: 'Region' }, 'North'), groupConstraint({ col: 'Date', part: 'year' }, Date.UTC(2023, 0, 1))];
    expect(en.rows(cs).length).toBe(G.query.filtered.rows);
    close(en.evaluate(sum, cs), G.query.filtered.sales);
    close(en.evaluate({ kind: 'col', col: 'Price', agg: 'avg' }, cs), G.query.filtered.avgPrice);
  });
  it('measure functions', () => {
    close(en.evaluate(m('Margin'), []), G.query.margin);
    close(en.evaluate(m('Nested'), []), G.query.margin * 100);
    close(en.evaluate(m('RowMath'), []), G.query.rowMath);
    close(en.evaluate(m('North'), []), G.query.sumIfNorth);
    close(en.evaluate(m('NorthCalc'), []), G.query.sumIfNorth);
    expect(en.evaluate(m('Large'), [])).toBe(G.query.countIfLarge);
    close(en.evaluate(m('AvgBiz'), []), G.query.avgIfBusiness);
    expect(en.evaluate(m('Regions'), [])).toBe(G.query.distinctRegion);
    close(en.evaluate(m('P90'), []), G.query.p90);
  });
  it('groups always add up to the overall total', () => {
    const r = queryCategories(en, { col: 'Region' }, [sum], []);
    close(r.series[0].data.reduce<number>((a, b) => a + (b ?? 0), 0), G.stats.sum);
    close(r.totals[0], G.stats.sum);
  });
  it('folds extra groups into Other without changing the total', () => {
    const f = queryCategories(en, { col: 'Region' }, [sum], [], { topN: 3 });
    expect(f.categories.at(-1)?.isOther).toBe(true);
    close(f.series[0].data.reduce<number>((a, b) => a + (b ?? 0), 0), G.stats.sum);
  });
  it('KPI compares like for like', () => {
    const k = queryKpi(en, sum, []);
    close(k.value, G.stats.sum);
    expect(k.previousLabel).toBe('last 12 months vs prior 12');
    const dates = (G.rows.Date as string[]).map((d) => Date.parse(`${d}T00:00:00Z`));
    const end = Math.max(...dates) + 1;
    const year = (ms: number, n: number) => { const d = new Date(ms); d.setUTCFullYear(d.getUTCFullYear() + n); return d.getTime(); };
    const within = (a: number, b: number) => sales.filter((_, i) => dates[i] >= a && dates[i] < b).reduce((x, y) => x + y, 0);
    const [cur, prev] = [within(year(end, -1), end), within(year(end, -2), year(end, -1))];
    close(k.change, (cur - prev) / prev, 6);
  });
  it('a partial earlier year produces no misleading comparison', () => {
    const cs = [{ col: 'Date', kind: 'range' as const, min: Date.UTC(2022, 0, 1), max: Date.UTC(2022, 11, 31) }];
    expect(queryKpi(en, sum, cs).change).toBeNull();
  });
  it('table totals only appear for additive values', () => {
    const base = { id: 'x', type: 'column', title: 'T', tooltips: [], axis: [{ col: 'Region' }] } as Omit<Visual, 'values'>;
    expect(visualTable(en, { ...base, values: [sum] } as Visual, [])?.additive[1]).toBe(true);
    const avg = visualTable(en, { ...base, values: [{ kind: 'col', col: 'Sales', agg: 'avg' }] } as Visual, [])!;
    expect(avg.additive[1]).toBe(false);
    close(avg.overall![1] as number, G.stats.mean);
  });
});

describe('report safeguards', () => {
  const daily = (end: number) => {
    const rows: (string | number)[][] = [];
    for (let t = Date.UTC(2023, 0, 1); t <= end; t += 86400000) rows.push([new Date(t).toISOString().slice(0, 10), 100]);
    return new Engine(inferTable({ name: 'd', source: 'd', headers: ['Day', 'Amount'], rows }).table);
  };
  const v = { id: 'v', type: 'variance', title: 'YoY', tooltips: [], values: [{ kind: 'col', col: 'Amount', agg: 'sum' }], axis: [{ col: 'Day', part: 'month' }] } as Visual;

  it('year-over-year leaves out a period that is not finished', () => {
    const r = queryVariance(daily(Date.UTC(2024, 5, 10)), v, [])!;
    expect(r.omitted).toBe('Jun 2024');
    expect(r.categories.at(-1)?.label).toBe('May 2024');
    // Every month has the same daily amount, so only leap-year February differs: 29 days against 28.
    r.categories.forEach((c, i) => expect(r.changes[i]).toBeCloseTo(c.label === 'Feb 2024' ? 1 / 28 : 0, 8));
  });
  it('keeps a finished final period', () => {
    const r = queryVariance(daily(Date.UTC(2024, 5, 30)), v, [])!;
    expect(r.omitted).toBeNull();
    expect(r.categories.at(-1)?.label).toBe('Jun 2024');
  });
  it('histogram bins whole numbers exactly', () => {
    const xs = [1, 1, 2, 3, 3, 3, 4, 5, 6, 6];
    const h = S.histogram(xs);
    expect(h.map((b) => b.start)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(h.map((b) => b.count)).toEqual([2, 1, 3, 1, 1, 2]);
  });
  it('histogram keeps every value', () => {
    expect(S.histogram(sales).reduce((n, b) => n + b.count, 0)).toBe(sales.length);
  });
});

describe('measure language', () => {
  const cols = ['Sales', 'Region', 'Date'];
  it('reports helpful errors', () => {
    expect(validateMeasure('SUM([Nope])', cols, []).error).toContain('Unknown field');
    expect(validateMeasure('[Sales] + 1', cols, []).error).toContain('must be inside');
    expect(validateMeasure('FOO(1)', cols, []).error).toContain('Unknown function');
    expect(validateMeasure('SUM([Sales]', cols, []).error).toContain('closing');
    expect(validateMeasure('SUM(SUM([Sales]))', cols, []).ok).toBe(false);
    expect(validateMeasure('[A] + 1', cols, ['A'], 'B', { A: '[B] * 2' }).error).toContain('itself');
  });
  it('accepts every documented form', () => {
    ['DIVIDE(SUM([Sales]), COUNTROWS(), 0)', 'IF(SUM([Sales]) > 10, 1, 0)', 'ROUND(AVERAGE([Sales]), 2)', 'CALCULATE(SUM([Sales]), ALL())',
      'CALCULATE(SUM([Sales]), [Region] = "N", ALL([Date]))', 'MOVINGAVG(SUM([Sales]), [Date], 6)', 'SUM([Sales]) * (1 + PARAM("Growth"))',
      'COUNTIF([Region] = "N")', 'PCTOFTOTAL(SUM([Sales]), [Region])']
      .forEach((f) => expect(validateMeasure(f, cols, []).error).toBeUndefined());
    expect(() => parseMeasure('1 + (2')).toThrow();
  });
  it('division by zero never produces infinity', () => {
    const t = inferTable({ name: 'x', source: 'x', headers: ['A', 'B'], rows: [[1, 0], [2, 0], [3, 0]] }).table;
    const en = new Engine(t, [{ name: 'D', expr: 'SUM([A]) / SUM([B])' }, { name: 'E', expr: 'DIVIDE(SUM([A]), SUM([B]), -1)' }]);
    expect(en.evaluate({ kind: 'measure', name: 'D' }, [])).toBeNull();
    expect(en.evaluate({ kind: 'measure', name: 'E' }, [])).toBe(-1);
  });
});
