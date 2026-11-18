// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import { cleanName, nameTaken } from '../src/core/names';

describe('renaming a file', () => {
  it.each([
    ['November report', 'November report'],
    ['  November   report  ', 'November report'],
    ['November report.xlsx', 'November report'],
    ['November report.CSV', 'November report'],
    ['Sales v1.2', 'Sales v1.2'],
    ['Region: North', 'Region: North'],
  ])('%s becomes %s', (typed, name) => expect(cleanName(typed, 'Old name')).toBe(name));
  it.each(['', '   ', '.xlsx'])('keeps the old name when "%s" is entered', (typed) => expect(cleanName(typed, 'Old name')).toBe('Old name'));
  it('limits very long names', () => expect(cleanName('a'.repeat(200), 'Old name')).toHaveLength(80));
  it('finds a name that is already used', () => {
    expect(nameTaken('old cases', ['Old Cases', 'New Cases'])).toBe(true);
    expect(nameTaken('Other cases', ['Old Cases', 'New Cases'])).toBe(false);
  });
});
