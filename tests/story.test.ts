// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { askAssistant, emptyMemory, explainChange, findColumns, searchReport, suggestImprovements, type AssistantContext } from '../src/core/assistant';
import { runAudit } from '../src/core/audit';
import { Engine, groupConstraint } from '../src/core/engine';
import { newReport } from '../src/core/insights';
import { inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import { buildStory, describeVisual } from '../src/core/story';
import { animatePresentation, timingXml } from '../src/export/presentation';
import { readCsv } from '../src/ingest/readers';
import { captionsFor, sceneSeconds, subtitles, timelineOf, toVideoScenes, type VideoProject } from '../src/video/project';

function setup(): AssistantContext {
  const [raw] = readCsv(readFileSync('public/samples/retail-sales.csv', 'utf8'), 'retail-sales.csv');
  const { table, inferred } = inferTable(raw);
  const findings = runAudit(table, inferred);
  const clean = applyRecipe(table, findings.filter((f) => f.auto).flatMap((f) => f.steps));
  const en = new Engine(clean);
  return { en, report: newReport(en, 'Retail'), findings, cs: [], memory: emptyMemory() };
}
const ctx = setup();
const net = ctx.en.table.columns.find((c) => c.name === 'Net Sales')!.values as number[];
const region = ctx.en.table.columns.find((c) => c.name === 'Region')!.values as string[];
const total = net.reduce((a, b) => a + b, 0);
const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe('report assistant', () => {
  it('answers totals with the exact calculated figure', () => {
    expect(askAssistant('What is the total net sales?', ctx).text).toContain(total.toLocaleString('en-US', { maximumFractionDigits: 2 }).split('.')[0]);
  });
  it('applies a value mentioned in the question', () => {
    const north = net.filter((_, i) => region[i] === 'North').reduce((a, b) => a + b, 0);
    const r = askAssistant('total net sales in North', ctx);
    expect(r.text).toContain(north.toLocaleString('en-US', { maximumFractionDigits: 0 }).slice(0, 5));
    expect(r.text).toContain('for North');
  });
  it('ranks groups and offers to add the chart', () => {
    const r = askAssistant('top 3 region by net sales', ctx);
    expect(r.table?.rows).toHaveLength(3);
    const sums = new Map<string, number>();
    region.forEach((g, i) => sums.set(g, (sums.get(g) ?? 0) + net[i]));
    const best = [...sums].sort((a, b) => b[1] - a[1])[0];
    expect(r.table?.rows[0][0]).toBe(best[0]);
    expect(r.actions[0].type).toBe('addChart');
  });
  it('finds the lowest group when asked', () => {
    const r = askAssistant('which region has the lowest net sales', ctx);
    const sums = new Map<string, number>();
    region.forEach((g, i) => sums.set(g, (sums.get(g) ?? 0) + net[i]));
    expect(r.text.startsWith([...sums].sort((a, b) => a[1] - b[1])[0][0])).toBe(true);
  });
  it('explains a change using parts that add up to it', () => {
    const r = explainChange(ctx, { kind: 'col', col: 'Net Sales', agg: 'sum' })!;
    expect(r.text).toMatch(/Net Sales (rose|fell) by/);
    expect(r.table?.rows.length).toBeGreaterThan(0);
  });
  it('learns a word for this report only', () => {
    const teach = askAssistant('remember that turnover means Net Sales', ctx);
    expect(teach.actions[0]).toMatchObject({ type: 'remember', word: 'turnover', column: 'Net Sales' });
    const memory = { ...emptyMemory(), synonyms: { turnover: 'Net Sales' } };
    expect(findColumns('what is total turnover', ctx.en, memory)[0].name).toBe('Net Sales');
    expect(findColumns('what is total turnover', ctx.en, emptyMemory())).toHaveLength(0);
  });
  it('suggests improvements and respects dismissals', () => {
    const list = suggestImprovements(ctx);
    expect(list.length).toBeGreaterThan(2);
    expect(list.map((x) => x.priority)).toEqual([...list.map((x) => x.priority)].sort((a, b) => b - a));
    const first = list[0].id;
    expect(suggestImprovements({ ...ctx, memory: { ...emptyMemory(), dismissed: [first] } }).some((x) => x.id === first)).toBe(false);
  });
  it('does not make up an answer outside the report', () => {
    expect(askAssistant('what is the weather on mars', ctx).text).toContain('could not find');
  });
  it('searches facts inside the report', () => {
    expect(searchReport('blank values in unit price column', ctx)[0].text).toContain('Unit Price');
  });
  it('creates working measures', () => {
    for (const s of suggestImprovements(ctx)) {
      if (s.action?.type !== 'addMeasure') continue;
      const e = new Engine(ctx.en.table, [s.action.measure]);
      expect(e.evaluate({ kind: 'measure', name: s.action.measure.name }, [groupConstraint({ col: 'Order Date', part: 'year' }, Date.UTC(2024, 0, 1))])).not.toBeNull();
    }
  });
});

describe('report story', () => {
  const story = buildStory(ctx.en, ctx.report, ctx.findings, [], { detail: 'detailed', filterText: 'None', actions: ['Add a target column'] });
  it('covers the report from opening to close', () => {
    expect(story[0].kind).toBe('title');
    expect(story.at(-1)?.kind).toBe('closing');
    ['kpis', 'chart', 'findings', 'quality', 'actions'].forEach((k) => expect(story.some((s) => s.kind === k)).toBe(true));
    story.forEach((s) => { expect(s.narration.length).toBeGreaterThan(15); expect(s.narration).not.toMatch(/undefined|NaN|null/); });
  });
  it('states the real top group for a bar chart', () => {
    const v = ctx.report.pages.flatMap((p) => p.visuals).find((x) => x.type === 'bar')!;
    const d = describeVisual(ctx.en, v, [])!;
    const col = v.axis[0].col;
    const vals = ctx.en.table.columns.find((c) => c.name === col)!.values as string[];
    const gross = ctx.en.table.columns.find((c) => c.name === 'Gross Sales')!.values as number[];
    const sums = new Map<string, number>();
    vals.forEach((g, i) => sums.set(g, (sums.get(g) ?? 0) + gross[i]));
    const [top, y] = [...sums].sort((a, b) => b[1] - a[1])[0];
    const whole = gross.reduce((a, b) => a + b, 0);
    expect(d.headline).toBe(`${top} leads ${col} with ${(y / whole * 100).toFixed(1)}%`);
  });
  it('brief scripts are shorter than detailed ones', () => {
    const size = (d: 'brief' | 'detailed') => buildStory(ctx.en, ctx.report, ctx.findings, [], { detail: d, filterText: 'None' }).reduce((n, s) => n + s.narration.length, 0);
    expect(size('brief')).toBeLessThan(size('detailed'));
  });
  void money;
});

describe('video timing', () => {
  const scenes = toVideoScenes(buildStory(ctx.en, ctx.report, ctx.findings, [], { detail: 'brief', filterText: 'None' }));
  const project: VideoProject = { format: 'landscape', quality: 720, styleId: 'clean', music: 'none', captions: true, presenter: false, pace: 2.4, scenes };
  it('gives each scene enough time for its script', () => {
    scenes.forEach((s) => expect(sceneSeconds(s, 2.4)).toBeGreaterThanOrEqual(s.narration.split(/\s+/).length / 2.4));
  });
  it('a recorded voice sets the scene length', () => {
    expect(sceneSeconds(scenes[0], 2.4, 20)).toBeCloseTo(20.6, 5);
  });
  it('captions cover every word in order without overlapping', () => {
    const text = 'One two three. Four five six seven eight nine ten eleven twelve thirteen fourteen. Fifteen.';
    const c = captionsFor(text, 12);
    expect(c.map((x) => x.text).join(' ')).toBe(text);
    c.slice(1).forEach((x, i) => expect(x.start).toBeCloseTo(c[i].end, 8));
    expect(c.at(-1)!.end).toBeLessThanOrEqual(12);
  });
  it('subtitles use valid timestamps', () => {
    const srt = subtitles(project, timelineOf(project, new Map()));
    expect(srt.split('\n')[1]).toMatch(/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/);
  });
});

describe('animated PowerPoint', () => {
  it('writes well-formed unique animation steps', () => {
    const xml = timingXml([{ spid: 2, effect: 'fade', ms: 400 }, { spid: 3, effect: 'wipe', ms: 800 }]);
    const ids = [...xml.matchAll(/<p:cTn id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(xml.match(/<p:spTgt spid="3"\/>/g)).toHaveLength(2);
  });
  it('adds a transition and timing in the required order', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text 0"/></p:nvSpPr></p:sp><p:pic><p:nvPicPr><p:cNvPr id="3" name="Image 1"/></p:nvPicPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
    const out = await JSZip.loadAsync(await animatePresentation(await zip.generateAsync({ type: 'arraybuffer' })));
    const xml = await out.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml.indexOf('</p:clrMapOvr>')).toBeLessThan(xml.indexOf('<p:transition'));
    expect(xml.indexOf('<p:transition')).toBeLessThan(xml.indexOf('<p:timing'));
    expect(xml.endsWith('</p:timing></p:sld>')).toBe(true);
  });
});
