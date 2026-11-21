import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/core/audit';
import { chooseTables } from '../src/core/autoReport';
import { Engine } from '../src/core/engine';
import { guidePlan, guideSteps, isStepDone, nextSample, type GuideInput } from '../src/core/guide';
import { newReport } from '../src/core/insights';
import { isMswdUpload } from '../src/core/mswdSources';
import { inferTable } from '../src/core/parse';
import { SAMPLES, sampleGuideId } from '../src/core/samples';
import { DEFAULT_LOCALE } from '../src/core/types';
import { readCsv } from '../src/ingest/readers';

const read = (file: string) => readCsv(readFileSync(join(__dirname, '..', 'public', 'samples', file), 'utf8'), file);

describe('sample data', () => {
  it('lists every sample from the simplest to the most advanced', () => {
    const levels = SAMPLES.map((s) => s.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels[0]).toBe(1);
    expect(levels[levels.length - 1]).toBe(4);
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
  });

  for (const s of SAMPLES) {
    it(`${s.name} opens as a normal report`, () => {
      s.files.forEach((f) => expect(existsSync(join(__dirname, '..', 'public', 'samples', f))).toBe(true));
      const tables = s.files.flatMap(read);
      expect(isMswdUpload(tables)).toBe(false);
      const pick = chooseTables(tables);
      expect(pick.tables.length).toBe(s.files.length);
      expect(pick.combine.mode).toBe(s.files.length > 1 ? 'append' : 'single');
      const { table, inferred } = inferTable(pick.tables[0], DEFAULT_LOCALE);
      runAudit(table, inferred);
      const report = newReport(new Engine(table, [], []), s.name);
      expect(report.pages.length).toBeGreaterThan(0);
    });
  }

  it('starts simple: the budget has four clean columns and no data problems', () => {
    const [raw] = read('monthly-budget.csv');
    expect(raw.headers).toEqual(['Month', 'Category', 'Planned', 'Actual']);
    const { table, inferred } = inferTable(raw, DEFAULT_LOCALE);
    expect(runAudit(table, inferred).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('ends advanced: the supply chain sample has planted problems to find', () => {
    const [raw] = read('supply-chain.csv');
    expect(raw.headers.length).toBe(16);
    const { table, inferred } = inferTable(raw, DEFAULT_LOCALE);
    expect(runAudit(table, inferred).length).toBeGreaterThan(2);
  });
});

describe('next-step guide', () => {
  const base: GuideInput = { route: 'home', done: [], onScreen: [], autoMode: false, review: 0, filtered: false };
  const screen = (input: GuideInput) => ({ ...input, onScreen: guideSteps(input).flatMap((s) => s.targets) });

  it('suggests the simplest sample first, then the next level', () => {
    expect(guidePlan(screen(base)).pending[0].id).toBe('sample-budget');
    const after = screen({ ...base, done: ['sample-budget'] });
    expect(guidePlan(after).pending.map((s) => s.id)).toEqual(['sample-cafe', 'auto-mode', 'upload']);
    expect(nextSample(SAMPLES.map(sampleGuideId))).toBeUndefined();
  });

  it('walks a new report in teaching order and skips what is not on the screen', () => {
    const report = screen({ ...base, route: 'report' });
    expect(guidePlan(report).pending.map((s) => s.id).slice(0, 5)).toEqual(['analyst', 'add-filter', 'assistant-tab', 'add-page', 'design']);
    const narrow = { ...report, onScreen: ['add-filter', 'download'] };
    expect(guidePlan(narrow).pending.map((s) => s.id)).toEqual(['add-filter', 'assistant-tab', 'download']);
  });

  it('counts a step as done when its button was clicked or its result is visible', () => {
    const steps = guideSteps({ ...base, route: 'report' });
    const filter = steps.find((s) => s.id === 'add-filter')!;
    expect(isStepDone(filter, { done: [], filtered: true })).toBe(true);
    expect(isStepDone(steps.find((s) => s.id === 'analyst')!, { done: ['analyst-panel'], filtered: false })).toBe(true);
    // Going home does not count as trying the next sample.
    const next = steps.find((s) => s.id.startsWith('next-'))!;
    expect(isStepDone(next, { done: ['home'], filtered: false })).toBe(false);
  });

  it('asks for a review only when issues are waiting', () => {
    expect(guideSteps({ ...base, route: 'report' }).some((s) => s.id === 'data')).toBe(false);
    expect(guideSteps({ ...base, route: 'report', review: 2 }).find((s) => s.id === 'data')?.title).toBe('Review 2 data issues');
  });
});
