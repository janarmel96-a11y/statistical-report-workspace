// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import { areaConstraints, areaLevels, areaOptions, areaSummary, listLabels, tidyAreas } from '../src/core/areas';
import { runAudit } from '../src/core/audit';
import { Engine } from '../src/core/engine';
import { generateInsights, newReport } from '../src/core/insights';
import { inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import { buildStory, describeVisual } from '../src/core/story';
import type { RawCell } from '../src/core/types';

/** All places and records below are invented. */
const PLACES: [string, string, string, number][] = [
  ['North Province', 'Alpha City', 'Oak', 40], ['North Province', 'Alpha City', 'Pine', 30], ['North Province', 'Bravo Town', 'Elm', 50],
  ['South Province', 'Cedar Town', 'Ash', 60], ['South Province', 'Cedar Town', 'Oak', 20], ['South Province', 'Delta City', 'Fir', 25],
];
const rows: RawCell[][] = PLACES.flatMap(([p, m, b, n]) => Array.from({ length: n }, (_, i) => [`R${m}${b}${i}`, p, m, b, i % 3 ? 'Female' : 'Male']));
const { table, inferred } = inferTable({ name: 'Cases', source: 'cases.xlsx', headers: ['Ref', 'Province', 'Municipality', 'Barangay', 'Sex'], rows });
const en = new Engine(applyRecipe(table, runAudit(table, inferred).filter((f) => f.auto).flatMap((f) => f.steps)));
const levels = areaLevels(en);
const names = (col: string, pick = {}) => areaOptions(en, levels, pick, col).map((o) => o.label);

describe('choosing areas', () => {
  it('finds area levels from widest to narrowest', () => {
    expect(levels).toEqual(['Province', 'Municipality', 'Barangay']);
  });
  it('lists each area with its record count', () => {
    expect(areaOptions(en, levels, {}, 'Municipality')).toEqual([
      { value: 'Alpha City', label: 'Alpha City', count: 70 }, { value: 'Bravo Town', label: 'Bravo Town', count: 50 },
      { value: 'Cedar Town', label: 'Cedar Town', count: 80 }, { value: 'Delta City', label: 'Delta City', count: 25 },
    ]);
  });
  it('limits narrower lists to the areas chosen above them', () => {
    expect(names('Municipality', { Province: ['South Province'] })).toEqual(['Cedar Town', 'Delta City']);
    expect(names('Barangay', { Municipality: ['Alpha City'] })).toEqual(['Oak', 'Pine']);
  });
  it('counts a repeated barangay name only inside the chosen municipality', () => {
    expect(areaOptions(en, levels, { Municipality: ['Cedar Town'] }, 'Barangay').find((o) => o.label === 'Oak')!.count).toBe(20);
  });
  it('drops choices that no longer fit a changed area', () => {
    expect(tidyAreas(en, levels, { Province: ['North Province'], Municipality: ['Alpha City', 'Cedar Town'], Barangay: ['Pine', 'Ash'] }))
      .toEqual({ Province: ['North Province'], Municipality: ['Alpha City'], Barangay: ['Pine'] });
  });
  it('removes levels left empty', () => {
    expect(tidyAreas(en, levels, { Province: ['South Province'], Municipality: ['Alpha City'] })).toEqual({ Province: ['South Province'] });
  });
});

describe('presenting chosen areas', () => {
  const cs = areaConstraints({ Municipality: ['Alpha City', 'Delta City'] });
  it('counts only the chosen areas', () => {
    expect(en.rows(cs).length).toBe(95);
    expect(en.rows([]).length).toBe(225);
  });
  it('bases findings on the chosen areas only', () => {
    const text = generateInsights(en, cs, 'Municipality: Alpha City, Delta City').map((i) => i.text).join(' ');
    expect(text).not.toMatch(/Bravo Town|Cedar Town/);
  });
  it('tells the audience which areas are shown', () => {
    const story = buildStory(en, newReport(en, 'Cases'), [], cs, { detail: 'detailed', filterText: 'Municipality: Alpha City, Delta City' });
    expect(story[0].bullets[0]).toBe('95 records. Showing Municipality: Alpha City, Delta City');
    expect(story[0].narration).toContain('filtered to Municipality: Alpha City, Delta City');
    expect(story.map((s) => `${s.title} ${s.narration}`).join(' ')).not.toMatch(/Bravo Town|Cedar Town/);
  });
  it('skips a comparison chart when one area is left', () => {
    const v = { id: 'v', type: 'bar' as const, title: 'By town', axis: [{ col: 'Municipality' }], values: [{ kind: 'col' as const, col: 'Ref', agg: 'rows' as const }], tooltips: [] };
    expect(describeVisual(en, v, areaConstraints({ Municipality: ['Alpha City'] }))).toBeNull();
    expect(describeVisual(en, v, cs)!.headline).toBe('Alpha City leads Municipality with 73.7%');
  });
  it('keeps long lists short enough to read aloud', () => {
    expect(listLabels(['A', 'B', 'C'], 2)).toBe('A, B, and 1 more');
    expect(listLabels(['A', 'B'], 2)).toBe('A, B');
    expect(areaSummary(levels, { Province: ['North Province'], Municipality: ['Alpha City'] })).toBe('Province: North Province; Municipality: Alpha City');
  });
});
