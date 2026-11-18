// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import { inferTable } from '../src/core/parse';
import { applyRecipe, describeStep, reusableSteps } from '../src/core/recipe';
import type { Step } from '../src/core/types';

/** All records below are invented. */
const { table } = inferTable({
  name: 'Test', source: 'test.csv', headers: ['Ref', 'Town', 'Status', 'Score', 'Notes'],
  rows: Array.from({ length: 12 }, (_, i) => [`R${i}`, i % 2 ? 'North' : 'South', i % 3 ? 'Open' : 'Closed', i * 2, `Note ${i}`]),
});
const names = (t: typeof table) => t.columns.map((c) => c.name);

describe('removing several columns', () => {
  const step: Step = { op: 'dropColumns', cols: ['Town', 'Score', 'Notes'] };

  it('removes every selected column in one step', () => {
    expect(names(applyRecipe(table, [step]))).toEqual(['Ref', 'Status']);
  });
  it('keeps every row and the values in other columns', () => {
    const out = applyRecipe(table, [step]);
    expect(out.rowCount).toBe(12);
    expect(out.columns[1].values).toEqual(table.columns[2].values);
  });
  it('restores all of them when the one step is undone', () => {
    expect(names(applyRecipe(table, [step].slice(0, 0)))).toEqual(names(table));
  });
  it('ignores a column that no longer exists', () => {
    expect(names(applyRecipe(table, [{ op: 'dropColumns', cols: ['Town', 'Missing'] }]))).toEqual(['Ref', 'Status', 'Score', 'Notes']);
  });
  it('records what was removed in the audit trail', () => {
    expect(describeStep(step)).toBe('Removed 3 columns: Town, Score, Notes');
    expect(describeStep({ op: 'dropColumns', cols: ['Town'] })).toBe('Removed 1 column: Town');
  });
  it('stays removed when the report data is refreshed', () => {
    expect(reusableSteps([step])).toEqual([step]);
  });
});
