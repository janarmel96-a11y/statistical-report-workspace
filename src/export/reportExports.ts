// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { Engine } from '../core/engine';
import { formatNumber, formatPct } from '../core/format';
import { generateInsights, profileTable } from '../core/insights';
import { queryKpi, visualConstraints, visualTable, type ReportDoc, type Visual } from '../core/report';
import type { Constraint, DataTable, Finding } from '../core/types';
import { buildChart, vizTheme } from '../ui/chartOptions';
import { renderChartImage } from '../ui/EChart';
import { buildCsv, buildWorkbook, type WorkbookInput } from './workbook';
import { verifyWorkbook } from './verify';

export interface ExportContext {
  report: ReportDoc; engine: Engine; table: DataTable; findings: Finding[]; constraints: Constraint[]; filterText: string; palette: 'standard' | 'bright';
}

export type Progress = (message: string) => void;

const NO_CHART = new Set(['kpi', 'insights', 'table']);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'report';
}

export function download(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const allVisuals = (r: ReportDoc): Visual[] => {
  const seen = new Set<string>();
  return r.pages.flatMap((p) => p.visuals).filter((v) => { if (seen.has(v.title)) return false; seen.add(v.title); return true; });
};

interface ChartImage { visual: Visual; dataUrl: string; base64: string; width: number; height: number }

export function chartImages(ctx: ExportContext): ChartImage[] {
  const theme = vizTheme(false, ctx.palette);
  const out: ChartImage[] = [];
  for (const v of allVisuals(ctx.report)) {
    if (NO_CHART.has(v.type)) continue;
    const b = buildChart(ctx.engine, v, ctx.constraints, theme, null, null);
    if (b.meta.empty) continue;
    const img = renderChartImage(b.option);
    out.push({ visual: v, ...img, base64: img.dataUrl.split(',')[1] });
  }
  return out;
}

function kpiList(ctx: ExportContext) {
  const kpis = ctx.report.pages.flatMap((p) => p.visuals).filter((v) => v.type === 'kpi' && v.values[0]);
  const seen = new Set<string>();
  return kpis.filter((v) => { if (seen.has(v.title)) return false; seen.add(v.title); return true; }).map((v) => {
    const k = queryKpi(ctx.engine, v.values[0], visualConstraints(v, ctx.constraints));
    return {
      label: v.title, value: k.value, format: k.format, currency: k.currency,
      note: k.change !== null ? `${k.change >= 0 ? 'Up' : 'Down'} ${formatPct(Math.abs(k.change))}, ${k.previousLabel}` : undefined,
    };
  });
}

export function workbookInput(ctx: ExportContext, images: ChartImage[]): WorkbookInput {
  const rows = ctx.engine.rows(ctx.constraints);
  const byId = new Map(images.map((i) => [i.visual.id, i]));
  const visuals = allVisuals(ctx.report).filter((v) => v.type !== 'kpi').flatMap((v) => {
    const t = visualTable(ctx.engine, v, ctx.constraints);
    if (!t) return [];
    const img = byId.get(v.id);
    return [{ ...t, image: img ? { base64: img.base64, width: img.width, height: img.height } : undefined }];
  });
  return {
    title: ctx.report.title, generatedAt: new Date(), filters: ctx.filterText, kpis: kpiList(ctx),
    insights: generateInsights(ctx.engine, ctx.constraints, ctx.filterText), visuals, data: ctx.table, rows,
    profile: profileTable(ctx.table), findings: ctx.findings, measures: ctx.report.measures,
  };
}

/** Builds, re-opens, and verifies the workbook before the browser is allowed to download it. */
export async function exportWorkbook(ctx: ExportContext, target: 'excel' | 'sheets', progress: Progress) {
  progress('Preparing charts');
  await nextFrame();
  const images = target === 'excel' ? chartImages(ctx) : [];
  progress('Writing workbook');
  await nextFrame();
  const input = workbookInput(ctx, images);
  const buf = await buildWorkbook(input, { target });
  progress('Checking the finished file');
  await nextFrame();
  await verifyWorkbook(buf, input);
  const suffix = target === 'sheets' ? ' (Google Sheets)' : '';
  download(buf, `${safeFileName(ctx.report.title)}${suffix}.xlsx`, XLSX_MIME);
}

export function exportCsv(ctx: ExportContext) {
  download(buildCsv(ctx.table, ctx.engine.rows(ctx.constraints)), `${safeFileName(ctx.report.title)}.csv`, 'text/csv;charset=utf-8');
}

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

/** Standard PDF fonts cover Latin text only, so other symbols get readable equivalents. */
function pdfText(s: string) {
  return s.replace(/₱/g, 'PHP ').replace(/₹/g, 'INR ').replace(/₩/g, 'KRW ').replace(/₫/g, 'VND ').replace(/฿/g, 'THB ').replace(/€/g, 'EUR ')
    .replace(/[−–—]/g, '-').replace(/×/g, 'x').replace(/÷/g, '/').replace(/→/g, 'to').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ]/g, '');
}

export async function exportPdf(ctx: ExportContext, progress: Progress) {
  progress('Preparing charts');
  await nextFrame();
  const images = chartImages(ctx);
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  const [W, H] = [doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight()];
  const M = 40;
  const footer = () => {
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(pdfText(ctx.report.title), M, H - 20);
    doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 20, { align: 'right' });
  };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(11);
  doc.text(pdfText(ctx.report.title), M, 64, { maxWidth: W - 2 * M });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text(pdfText(`Generated ${new Date().toISOString().slice(0, 10)}. Filters: ${ctx.filterText}. Rows: ${ctx.engine.rows(ctx.constraints).length.toLocaleString('en-US')}.`), M, 86, { maxWidth: W - 2 * M });

  const kpis = kpiList(ctx).slice(0, 4);
  const tw = (W - 2 * M - 12 * Math.max(0, kpis.length - 1)) / Math.max(1, kpis.length);
  kpis.forEach((k, i) => {
    const x = M + i * (tw + 12);
    doc.setDrawColor(220); doc.setFillColor(248, 248, 246); doc.roundedRect(x, 106, tw, 76, 8, 8, 'FD');
    doc.setFontSize(9); doc.setTextColor(90); doc.text(pdfText(k.label), x + 12, 126, { maxWidth: tw - 24 });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(11);
    doc.text(pdfText(formatNumber(k.value, { format: k.format, currency: k.currency, compact: true })), x + 12, 154);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90);
    if (k.note) doc.text(pdfText(k.note), x + 12, 171, { maxWidth: tw - 24 });
  });
  let y = 214;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(11); doc.text('Key findings', M, y);
  y += 20;
  for (const ins of generateInsights(ctx.engine, ctx.constraints, ctx.filterText).slice(0, 8)) {
    const lines = doc.splitTextToSize(pdfText(ins.text), W - 2 * M) as string[];
    if (y + 16 + lines.length * 13 > H - 44) break;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(11); doc.text(pdfText(ins.headline), M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(70); doc.text(lines, M, y + 14);
    y += 22 + lines.length * 13;
  }
  footer();
  const cw = (W - 2 * M - 16) / 2;
  const ch = cw * (620 / 1120);
  images.forEach((img, i) => {
    if (i % 4 === 0) doc.addPage();
    const col = i % 2;
    const r = Math.floor((i % 4) / 2);
    const x = M + col * (cw + 16);
    const top = 36 + r * (ch + 34);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(11);
    doc.text(pdfText(img.visual.title), x, top, { maxWidth: cw });
    doc.addImage(img.dataUrl, 'PNG', x, top + 8, cw, ch, undefined, 'FAST');
    if (i % 4 === 3 || i === images.length - 1) footer();
  });
  download(doc.output('arraybuffer'), `${safeFileName(ctx.report.title)}.pdf`, 'application/pdf');
}

export async function exportPng(ctx: ExportContext, visuals: Visual[], progress: Progress) {
  progress('Drawing charts');
  await nextFrame();
  const theme = vizTheme(false, ctx.palette);
  const list = visuals.filter((v) => !NO_CHART.has(v.type)).flatMap((v) => {
    const b = buildChart(ctx.engine, v, ctx.constraints, theme, null, null);
    return b.meta.empty ? [] : [{ v, img: renderChartImage(b.option, 800, 460) }];
  });
  if (!list.length) throw new Error('This page has no charts to download.');
  const [cw, ch, pad, head] = [1200, 690, 36, 120];
  const cols = list.length > 1 ? 2 : 1;
  const rows = Math.ceil(list.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw + (cols + 1) * pad;
  canvas.height = head + rows * (ch + 64 + pad) + pad;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#0b0b0b'; c.font = '600 44px "Segoe UI", system-ui, sans-serif'; c.fillText(ctx.report.title, pad, 72);
  await Promise.all(list.map(({ v, img }, i) => new Promise<void>((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      const x = pad + (i % cols) * (cw + pad);
      const y = head + Math.floor(i / cols) * (ch + 64 + pad);
      c.fillStyle = '#0b0b0b'; c.font = '600 28px "Segoe UI", system-ui, sans-serif'; c.fillText(v.title, x, y + 34);
      c.drawImage(el, x, y + 56, cw, ch);
      resolve();
    };
    el.onerror = () => reject(new Error('Chart image failed'));
    el.src = img.dataUrl;
  })));
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
  download(blob, `${safeFileName(ctx.report.title)}.png`, 'image/png');
}

export function exportProject(ctx: ExportContext, raws: unknown, extras: Record<string, unknown>) {
  const json = JSON.stringify({ app: 'statistical-report-workspace', version: 1, raws, ...extras, report: ctx.report });
  download(json, `${safeFileName(ctx.report.title)}.statreport.json`, 'application/json');
}
