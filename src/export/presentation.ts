// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import JSZip from 'jszip';
import type PptxTypes from 'pptxgenjs';
import { analyzeReport, briefText } from '../core/analyst';
import { suggestImprovements, emptyMemory } from '../core/assistant';
import { buildStory, type StoryScene } from '../core/story';
import { forecastOption } from '../ui/analystChart';
import { renderChartImage } from '../ui/EChart';
import { chartImages, download, safeFileName, type ExportContext, type Progress } from './reportExports';

/**
 * Builds an animated presentation. Slides are written with PptxGenJS, then transitions and
 * entrance animations are added using PowerPoint's own animation format.
 */

type Effect = 'fade' | 'wipe' | 'rise';
export interface AnimatedShape { spid: number; effect: Effect; ms: number }

const PRESET: Record<Effect, { id: number; subtype: number; filter: string }> = {
  fade: { id: 10, subtype: 0, filter: 'fade' },
  wipe: { id: 22, subtype: 8, filter: 'wipe(left)' },
  rise: { id: 22, subtype: 4, filter: 'wipe(down)' },
};

/** Entrance animations that play one after another as soon as the slide appears. */
export function timingXml(shapes: AnimatedShape[]): string {
  if (!shapes.length) return '';
  let id = 3;
  let delay = 0;
  const steps = shapes.map((s) => {
    const p = PRESET[s.effect];
    const wrap = id++;
    const effect = id++;
    const set = id++;
    const anim = id++;
    const xml = `<p:par><p:cTn id="${wrap}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>`
      + `<p:par><p:cTn id="${effect}" presetID="${p.id}" presetClass="entr" presetSubtype="${p.subtype}" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`
      + `<p:set><p:cBhvr><p:cTn id="${set}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${s.spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
      + `<p:animEffect transition="in" filter="${p.filter}"><p:cBhvr><p:cTn id="${anim}" dur="${s.ms}"/><p:tgtEl><p:spTgt spid="${s.spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
      + '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>';
    delay += s.ms;
    return xml;
  }).join('');
  const outer = id++;
  return '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
    + '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
    + `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>${steps}</p:childTnLst></p:cTn></p:par>`
    + '</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
    + '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>'
    + '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
}

const TRANSITIONS = ['<p:fade/>', '<p:push dir="l"/>', '<p:wipe dir="l"/>', '<p:cover dir="l"/>'];

/** Adds a transition and animations to every slide of a finished presentation. */
export async function animatePresentation(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const name of slides) {
    const number = Number(name.match(/(\d+)\.xml$/)![1]);
    let xml = await zip.file(name)!.async('string');
    const shapes: AnimatedShape[] = [];
    for (const m of xml.matchAll(/<p:(sp|pic)>[\s\S]*?<p:cNvPr id="(\d+)" name="([^"]*)"/g)) {
      const isPicture = m[1] === 'pic';
      const isSlideNumber = /slide number/i.test(m[3]);
      if (!isSlideNumber) shapes.push({ spid: Number(m[2]), effect: isPicture ? 'wipe' : shapes.length ? 'rise' : 'fade', ms: isPicture ? 900 : 450 });
    }
    const transition = `<p:transition spd="med">${TRANSITIONS[number % TRANSITIONS.length]}</p:transition>`;
    xml = xml.replace(/<p:transition[\s\S]*?<\/p:transition>|<p:timing[\s\S]*?<\/p:timing>/g, '').replace('</p:sld>', `${transition}${timingXml(shapes)}</p:sld>`);
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

type Slide = ReturnType<PptxTypes['addSlide']>;

const INK = '0F1B2D';
const SUB = '52606F';
const ACCENT = '1C5CAB';
const SOFT = 'E8F0FB';
const NAVY = '0E2240';
const FONT = 'Segoe UI';

export async function exportPptx(ctx: ExportContext, progress: Progress) {
  progress('Writing the presentation');
  await new Promise((r) => setTimeout(r, 30));
  const images = new Map(chartImages(ctx).map((i) => [i.visual.id, i]));
  const actions = suggestImprovements({ en: ctx.engine, report: ctx.report, findings: ctx.findings, cs: ctx.constraints, memory: emptyMemory() }).slice(0, 4).map((s) => s.title);
  const scenes = buildStory(ctx.engine, ctx.report, ctx.findings, ctx.constraints, { detail: 'detailed', filterText: ctx.filterText, actions });
  const { default: PptxGenJS } = await import('pptxgenjs');
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  p.title = ctx.report.title;
  p.author = 'Statistical Report Workspace';

  const header = (s: Slide, scene: StoryScene) => {
    s.addText(scene.kicker.toUpperCase(), { x: 0.6, y: 0.34, w: 12.1, h: 0.32, fontFace: FONT, fontSize: 11, bold: true, color: ACCENT, charSpacing: 1.5, margin: 0 });
    s.addText(scene.title, { x: 0.6, y: 0.66, w: 12.1, h: 0.72, fontFace: FONT, fontSize: 26, bold: true, color: INK, margin: 0, fit: 'shrink', valign: 'top' });
  };
  const points = (s: Slide, bullets: string[], x: number, y: number, w: number, h: number) => {
    bullets.forEach((b, i) => s.addText(b, { shape: p.ShapeType.roundRect, rectRadius: 0.06, x, y: y + i * (h + 0.14), w, h, fill: { color: SOFT }, line: { color: SOFT, width: 0 }, fontFace: FONT, fontSize: 14, color: INK, margin: 10, valign: 'middle', fit: 'shrink' }));
  };

  // The analyst's slides follow the title: summary, forecast, and recommended actions.
  const brief = analyzeReport(ctx.engine, ctx.findings, ctx.constraints);
  const notes = briefText(brief);
  const aiSlides = () => {
    const sum = p.addSlide();
    sum.background = { color: 'FFFFFF' };
    sum.addNotes(notes);
    header(sum, { id: 'ai', kind: 'findings', kicker: 'Analyst', title: brief.headline, bullets: [], narration: '' });
    points(sum, brief.summary.slice(0, 4), 0.6, 1.75, 12.1, 0.95);
    sum.addText(`Confidence: ${brief.confidence.level}. ${brief.confidence.reason}`, { x: 0.6, y: 6.55, w: 12.1, h: 0.4, fontFace: FONT, fontSize: 11, color: SUB, margin: 0 });
    if (brief.forecast) {
      const fs = p.addSlide();
      fs.background = { color: 'FFFFFF' };
      fs.addNotes(brief.forecast.text);
      header(fs, { id: 'fc', kind: 'chart', kicker: 'Forecast', title: brief.forecast.text.split('. ')[0], bullets: [], narration: '' });
      const img = renderChartImage(forecastOption(brief, false, true));
      fs.addImage({ data: img.dataUrl, x: 0.6, y: 1.6, w: 8.1, h: 8.1 * (img.height / img.width), altText: brief.forecast.text });
      points(fs, [`Method: ${brief.forecast.method}`, brief.forecast.mape !== null ? `Backtest error about ${(brief.forecast.mape * 100).toFixed(0)}%` : 'Range shows 95% of likely values', ...(brief.trend ? [brief.trend.direction === 'flat' ? 'No significant trend' : `Significant ${brief.trend.direction}ward trend`] : [])], 9, 1.75, 3.73, 1.15);
    }
    const act = p.addSlide();
    act.background = { color: 'FFFFFF' };
    act.addNotes(notes);
    header(act, { id: 'act', kind: 'findings', kicker: 'Recommendations', title: 'What to do next', bullets: [], narration: '' });
    points(act, [...brief.risks.filter((r) => r.level !== 'low').slice(0, 2).map((r) => `Watch: ${r.text}`), ...brief.actions].slice(0, 5), 0.6, 1.75, 12.1, 0.82);
  };

  for (const scene of scenes) {
    const s = p.addSlide();
    s.addNotes(scene.narration);
    if (scene.kind === 'title' || scene.kind === 'closing') {
      s.background = { color: NAVY };
      s.addText(scene.kicker.toUpperCase(), { x: 0.9, y: 2.1, w: 11.5, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: '86B6EF', charSpacing: 2, margin: 0 });
      s.addText(scene.title, { x: 0.9, y: 2.55, w: 11.5, h: 1.4, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF', margin: 0, fit: 'shrink', valign: 'top' });
      if (scene.bullets[0]) s.addText(scene.bullets[0], { x: 0.9, y: 4.05, w: 11.5, h: 0.8, fontFace: FONT, fontSize: 18, color: 'CDE2FB', margin: 0, valign: 'top' });
      if (scene.kind === 'title') aiSlides();
      continue;
    }
    s.background = { color: 'FFFFFF' };
    s.slideNumber = { x: 12.45, y: 7.02, fontFace: FONT, fontSize: 10, color: SUB };
    header(s, scene);
    if (scene.kind === 'kpis' && scene.kpis) {
      const w = (12.1 - 0.25 * (scene.kpis.length - 1)) / scene.kpis.length;
      scene.kpis.forEach((k, i) => s.addText([
        { text: `${k.label}\n`, options: { fontSize: 14, color: SUB, breakLine: false } },
        { text: `${k.value}\n`, options: { fontSize: 36, bold: true, color: INK, breakLine: false } },
        { text: k.note ?? ' ', options: { fontSize: 13, color: k.note?.startsWith('Down') ? 'B42727' : '006300', bold: true } },
      ], { shape: p.ShapeType.roundRect, rectRadius: 0.08, x: 0.6 + i * (w + 0.25), y: 2.1, w, h: 2.9, fill: { color: SOFT }, line: { color: SOFT, width: 0 }, fontFace: FONT, margin: 14, valign: 'middle' }));
    } else if (scene.kind === 'chart' && scene.visualId && images.has(scene.visualId)) {
      const img = images.get(scene.visualId)!;
      const w = 8.1;
      s.addImage({ data: img.dataUrl, x: 0.6, y: 1.6, w, h: w * (620 / 1120), altText: scene.title });
      points(s, scene.bullets, 9, 1.75, 3.73, 1.15);
      const meaning = scene.narration.split(/(?<=[.!?])\s+/).slice(1, 3).join(' ');
      if (meaning) s.addText(meaning, { x: 0.6, y: 6.2, w: 11.7, h: 0.76, fontFace: FONT, fontSize: 13, color: SUB, margin: 0, valign: 'top', fit: 'shrink' });
    } else {
      points(s, scene.bullets, 0.6, 1.75, 12.1, 0.82);
    }
  }
  const raw = await p.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
  progress('Adding animations');
  const animated = await animatePresentation(raw);
  download(animated, `${safeFileName(ctx.report.title)}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}
