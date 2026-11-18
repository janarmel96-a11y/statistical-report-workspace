// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, backgroundLayers, cleanDesign, clonePage, contrast, DEFAULT_DESIGN, legibleAccent, resolveDesign, safeColor, safeImage, TEMPLATES, THEMES } from '../src/core/design';
import { ICON_TONE, iconFor } from '../src/core/fieldIcons';

describe('report icons', () => {
  it.each([
    ['Female', 'female'], ['Male', 'male'], ['Records by Sex', 'sex'], ['Age range (years)', 'age'], ['Records by Age Group', 'age'], ['Birthday', 'birthday'],
    ['Home Address', 'house'], ['Records by Province', 'map'], ['Records by Region', 'map'], ['Municipality', 'city'], ['Top Barangay', 'location'],
    ['Records over time', 'calendar'], ['Civil Status', 'marital'], ['Consent', 'consent'], ['Patient Status', 'patient'], ['Classification', 'category'],
    ['Gross Sales', 'money'], ['Total records', 'records'], ['Something else', 'chart'],
  ])('%s uses the %s icon', (text, key) => expect(iconFor(text)).toBe(key));
  it('never mistakes female for male', () => {
    expect(iconFor('Female leads Sex')).toBe('female');
    expect(iconFor('Male leads Sex')).toBe('male');
    expect(iconFor('Barangay Mandurriao')).toBe('location');
  });
  it('gives every icon a color', () => expect(Object.values(ICON_TONE).every((c) => Boolean(safeColor(c)))).toBe(true));
});

describe('report designs', () => {
  it.each(THEMES.map((t) => [t.name, t] as const))('%s keeps text readable in light and dark', (_, t) => {
    expect(contrast(t.accent, '#fcfcfb')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accentDark, '#1a1a19')).toBeGreaterThanOrEqual(4.5);
  });
  it('every template uses a design that exists', () => {
    TEMPLATES.forEach((t) => expect(cleanDesign(t)).toMatchObject({ theme: t.theme, background: t.background, card: t.card, font: t.font, corners: t.corners }));
  });
  it('every background can be drawn', () => {
    BACKGROUNDS.filter((b) => b.id !== 'none').forEach((b) => expect(backgroundLayers(b.id, '#1c5cab').image).not.toBe('none'));
  });
  it('makes a pale custom color readable', () => {
    const fixed = legibleAccent('#ffee88', '#fcfcfb');
    expect(contrast(fixed, '#fcfcfb')).toBeGreaterThanOrEqual(4.5);
    expect(resolveDesign({ accent: '#ffee88' }, false).vars['--accent']).toBe(fixed);
  });
  it('leaves a readable custom color unchanged', () => expect(legibleAccent('#1c5cab', '#fcfcfb')).toBe('#1c5cab'));
  it('uses the safe default for reports with no design', () => {
    expect(cleanDesign(undefined)).toMatchObject(DEFAULT_DESIGN);
    expect(resolveDesign(undefined, false).series).toBeNull();
  });
  it('uses standard chart colors in dark mode', () => expect(resolveDesign({ theme: 'emerald' }, true).series).toBeNull());
});

describe('shared report files cannot inject content', () => {
  it('rejects unsafe colors', () => {
    ['red;background:url(x)', 'url(https://example.com)', '#12345', 12].forEach((v) => expect(safeColor(v)).toBeUndefined());
    expect(safeColor('#1C5CAB')).toBe('#1C5CAB');
  });
  it('rejects outside pictures and scripts', () => {
    ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'data:image/png;base64,AA");}body{display:none'].forEach((v) => expect(safeImage(v)).toBeUndefined());
    expect(safeImage('data:image/png;base64,iVBORw0KGgo=')).toBeTruthy();
  });
  it('removes unknown design values', () => {
    const d = cleanDesign({ theme: 'x', background: 'y', card: 'z', font: 'q', corners: 'w', accent: 'bad', logo: 'https://example.com/a.png', backgroundImage: 'bad' });
    expect(d).toMatchObject({ theme: 'classic', background: 'none', card: 'solid', font: 'modern', corners: 'soft' });
    expect([d.accent, d.logo, d.backgroundImage]).toEqual([undefined, undefined, undefined]);
  });
});

describe('duplicating a page', () => {
  it('gives every item a new identity and keeps its position', () => {
    let n = 0;
    const page = { id: 'p', name: 'Overview', visuals: [{ id: 'a' }], elements: [{ id: 'b', kind: 'text' as const }], layout: [{ i: 'a', x: 1, y: 2, w: 3, h: 4 }, { i: 'b', x: 5, y: 6, w: 7, h: 8 }] };
    const copy = clonePage(page, () => `new${n++}`);
    expect(copy.name).toBe('Overview copy');
    expect(copy.id).not.toBe('p');
    expect(new Set([copy.visuals[0].id, copy.elements![0].id, copy.id]).size).toBe(3);
    expect(copy.layout).toEqual([{ i: copy.visuals[0].id, x: 1, y: 2, w: 3, h: 4 }, { i: copy.elements![0].id, x: 5, y: 6, w: 7, h: 8 }]);
    expect(page.visuals[0].id).toBe('a');
  });
});
