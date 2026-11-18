// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import { isLikelyTypo, runAudit } from '../src/core/audit';
import { Engine } from '../src/core/engine';
import { inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import type { Visual } from '../src/core/report';
import { describeVisual } from '../src/core/story';
import type { RawCell, ValueRef } from '../src/core/types';

/** All records below are invented. */
const engineOf = (headers: string[], rows: RawCell[][]) => {
  const { table, inferred } = inferTable({ name: 'Test', source: 'test.xlsx', headers, rows });
  const findings = runAudit(table, inferred);
  return { findings, en: new Engine(applyRecipe(table, findings.filter((f) => f.auto).flatMap((f) => f.steps))) };
};
const chart = (type: Visual['type'], axis: Visual['axis'], value: ValueRef): Visual => ({ id: 'v', type, title: 'Chart', axis, values: [value], tooltips: [] });

describe('trend wording', () => {
  const start = Date.UTC(2026, 10, 1);
  const daily = (ys: number[]) => engineOf(['Date', 'Cases'], ys.map((y, i) => [{ date: start + i * 86400000 }, y])).en;
  const line = chart('line', [{ col: 'Date', part: 'day' }], { kind: 'col', col: 'Cases', agg: 'sum' });

  it('does not claim a rise from two uneven days', () => {
    const en = daily([54, 200, 90, 236, 70, 180, 100, 150, 60, 210, 120, 170, 80, 190, 110, 140, 95, 202]);
    const d = describeVisual(en, line, [])!;
    expect(d.headline).toBe('Cases peaked in ' + d.bullets[0].replace('Peak: ', '').replace(', ', ' at '));
    expect(`${d.headline} ${d.sentences.join(' ')} ${d.takeaway}`).not.toMatch(/274|rose|a rise of|above its starting/);
    expect(d.sentences[1]).toContain('without a steady rise or fall');
  });
  it('still reports a change the whole series supports', () => {
    const d = describeVisual(daily([10, 12, 15, 17, 20, 24, 27, 30, 34, 38, 41, 45]), line, [])!;
    expect(d.headline).toMatch(/^Cases rose 350\.0% from /);
  });
  it('still compares a short series directly', () => {
    expect(describeVisual(daily([10, 30, 20, 40]), line, [])!.headline).toMatch(/^Cases rose 300\.0% from /);
  });
});

describe('blank groups', () => {
  const rows: RawCell[][] = Array.from({ length: 100 }, (_, i) => [`R${i}`, i < 44 ? null : i < 99 ? 'Signed' : 'Declined']);
  const { en } = engineOf(['Ref', 'Consent'], rows);
  const d = describeVisual(en, chart('bar', [{ col: 'Consent' }], { kind: 'col', col: 'Consent', agg: 'rows' }), [])!;
  const said = `${d.headline} ${d.bullets.join(' ')} ${d.sentences.join(' ')} ${d.takeaway}`;

  it('never ranks a blank as the leader', () => {
    expect(d.headline).toBe('Signed leads Consent with 55.0%');
    expect(said).not.toContain('(Blank)');
  });
  it('compares only real groups', () => {
    expect(d.sentences[0]).toContain('2 groups');
    expect(said).toContain('Declined is lowest');
  });
  it('states how much was not recorded', () => {
    expect(d.bullets).toContain('Not recorded: 44.0%');
    expect(d.sentences[2]).toBe('44.0% of the total has no Consent recorded, so it is not ranked as a group.');
  });
});

describe('misspelled labels', () => {
  it.each([['ilolo', 'iloilo'], ['dumanags', 'dumangas'], ['san joaquinn', 'san joaquin']])('%s matches %s', (a, b) => expect(isLikelyTypo(a, b)).toBe(true));
  it.each([['bago', 'bato'], ['balasan', 'balisan'], ['region vi', 'region vii'], ['ward 12', 'ward 123'], ['type a', 'type ab'], ['north town', 'south town'], ['male', 'female']])('%s stays separate from %s', (a, b) => expect(isLikelyTypo(a, b)).toBe(false));

  const pick = (i: number, list: [string, number][]) => { let at = i; for (const [v, n] of list) { if (at < n) return v; at -= n; } return null; };
  const rows: RawCell[][] = Array.from({ length: 240 }, (_, i) => [
    `R${i}`,
    pick(i, [['ILOILO', 200], ['ILOLO', 3], ['Capiz', 37]]),
    pick(i, [['Balasan', 200], ['Balisan', 2], ['Dumangas', 28], ['Dumanga', 10]]),
    pick(i, [['Region VI', 230], ['Region VII', 10]]),
  ]);
  const { en, findings } = engineOf(['Ref', 'Province', 'Town', 'Region'], rows);
  const count = (col: string, value: string) => en.table.columns.find((c) => c.name === col)!.values.filter((v) => v === value).length;

  it('counts a rare misspelling with the common label', () => {
    expect(count('Province', 'ILOILO')).toBe(203);
    expect(count('Province', 'ILOLO')).toBe(0);
    expect(en.table.rowCount).toBe(240);
  });
  it('explains the change so it can be switched off', () => {
    const f = findings.find((x) => x.title.includes('misspelled'))!;
    expect(f.column).toBe('Province');
    expect(f.detail).toContain('"ILOLO" (3) → "ILOILO" (200)');
  });
  it('keeps labels that may be different places', () => {
    expect(count('Town', 'Balisan')).toBe(2);
    expect(count('Town', 'Dumanga')).toBe(10);
    expect(count('Region', 'Region VII')).toBe(10);
  });
});
