// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/core/audit';
import { Engine } from '../src/core/engine';
import { newReport } from '../src/core/insights';
import { inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import { buildStory } from '../src/core/story';
import { readCsv } from '../src/ingest/readers';
import { bestVoice, sentenceOffsets, speechRate, splitSentences, spokenText } from '../src/video/speech';

describe('spoken figures', () => {
  it.each([
    ['Sales reached $79.4K.', 'Sales reached 79.4 thousand dollars.'],
    ['A loss of -$1,250.50 occurred.', 'A loss of minus 1,250.50 dollars occurred.'],
    ['Income was ₱2.5M.', 'Income was 2.5 million pesos.'],
    ['Total is 95.6B units.', 'Total is 95.6 billion units.'],
    ['Female is 57.9% of records.', 'Female is 57.9 percent of records.'],
    ['Results for Q3 2025 improved.', 'Results for the third quarter of 2025 improved.'],
    ['It peaked in Nov 2024.', 'It peaked in November 2024.'],
    ['Data from 2026-11-17 is final.', 'Data from November 17, 2026 is final.'],
    ['The 18-29 group grew.', 'The 18 to 29 group grew.'],
    ['Online vs Retail.', 'Online versus Retail.'],
    ['This is significant, p < 0.001.', 'This is significant, a p value below 0.001.'],
    ['Welcome to retail-sales.', 'Welcome to retail sales.'],
  ])('%s', (a, b) => expect(spokenText(a)).toBe(b));
});

describe('sentence timing', () => {
  it('never splits a decimal or percentage', () => {
    expect(splitSentences('North is 27.1% of sales. South is $4.5K. Done!')).toEqual(['North is 27.1% of sales.', 'South is $4.5K.', 'Done!']);
  });
  it('keeps every word when breaking a long sentence', () => {
    const long = Array.from({ length: 40 }, (_, i) => `part number ${i},`).join(' ');
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(170));
    expect(parts.join(' ')).toBe(long);
  });
  it('places sentences in order inside the scene', () => {
    const at = sentenceOffsets(['one two', 'three four five six'], 10);
    expect(at).toHaveLength(3);
    expect(at[0]).toBeLessThan(at[1]);
    expect(at[1]).toBeCloseTo(0.2 + (2 / 6) * 9.4, 8);
    expect(at[2]).toBeLessThanOrEqual(10);
  });
  it('uses a measured speaking speed', () => {
    expect(speechRate(2.4)).toBeCloseTo(0.923, 3);
    expect(speechRate(9)).toBe(1.25);
  });
  it('prefers a clear English voice', () => {
    expect(bestVoice([{ name: 'Basic', lang: 'en-GB' }, { name: 'Microsoft Zira', lang: 'en-US' }])).toBe('Microsoft Zira');
    expect(bestVoice([])).toBe('off');
  });
});

describe('presenter script', () => {
  const [raw] = readCsv(readFileSync('public/samples/retail-sales.csv', 'utf8'), 'retail-sales.csv');
  const { table, inferred } = inferTable(raw);
  const findings = runAudit(table, inferred);
  const en = new Engine(applyRecipe(table, findings.filter((f) => f.auto).flatMap((f) => f.steps)));
  const story = buildStory(en, newReport(en, 'Retail Review'), findings, [], { detail: 'standard', filterText: 'None', actions: ['Add a target column'] });
  const charts = story.filter((s) => s.kind === 'chart');
  it('opens and closes like a presentation', () => {
    expect(story[0].narration).toContain('welcome to the statistical review of Retail Review');
    expect(story.at(-1)!.narration).toMatch(/^In summary,/);
    expect(story.at(-1)!.narration).toMatch(/Thank you for watching\.$/);
  });
  it('links each chart to the one before it', () => {
    expect(charts[0].narration).toMatch(/^To begin, this/);
    expect(charts[1].narration).toMatch(/^Next, this/);
  });
  it('ends each chart with a clear takeaway', () => {
    charts.forEach((s) => expect(s.narration).toContain('The key takeaway is'));
  });
  it('every spoken line reads naturally', () => {
    story.forEach((s) => splitSentences(s.narration).map(spokenText).forEach((line) => expect(line).not.toMatch(/[$₱%]|\d[KMBT]\b|\bQ[1-4] \d{4}/)));
  });
});
