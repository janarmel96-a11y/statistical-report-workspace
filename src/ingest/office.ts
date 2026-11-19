// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import JSZip from 'jszip';
import type { RawCell, RawTable } from '../core/types';
import { gridToTables } from './grid';

/**
 * Reads the tables inside Word (.docx) and PowerPoint (.pptx) reports, such as a statistical report with
 * tables of results. Merged cells repeat their value so grouped labels are not lost. Numbers stay text here
 * and are recognized later, like any other text column.
 */

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** The text of one cell: its paragraphs on separate lines, its runs joined. */
function cellText(xml: string, para: string, text: string): string {
  const paragraphs = xml.split(new RegExp(`</${para}>`)).map((p) => [...p.matchAll(new RegExp(`<${text}(?:\\s[^>]*)?>([^<]*)</${text}>`, 'g'))].map((m) => decode(m[1])).join(''));
  return paragraphs.filter((p) => p.trim() !== '').join('\n').trim();
}

/** The outermost <tag>…</tag> blocks, counting nesting so a table inside a table stays inside its cell. */
function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, 'g');
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (const m of xml.matchAll(re)) {
    if (m[1] !== '/') {
      if (m[2] === '/') { if (depth === 0) out.push(m[0]); continue; }
      if (depth++ === 0) start = m.index!;
    } else if (--depth === 0 && start >= 0) {
      out.push(xml.slice(start, m.index! + m[0].length));
      start = -1;
    }
  }
  return out;
}

function wordTable(xml: string): RawCell[][] {
  const grid: RawCell[][] = [];
  for (const tr of blocks(xml, 'w:tr')) {
    const row: RawCell[] = [];
    for (const tc of blocks(tr, 'w:tc')) {
      const span = Number(tc.match(/<w:gridSpan w:val="(\d+)"/)?.[1] ?? 1);
      // A cell continuing a vertical merge repeats the value above it.
      const continues = /<w:vMerge(?![^>]*w:val="restart")[^>]*\/>/.test(tc);
      const value = continues ? grid[grid.length - 1]?.[row.length] ?? null : cellText(tc, 'w:p', 'w:t') || null;
      for (let k = 0; k < span; k++) row.push(value);
    }
    grid.push(row);
  }
  return grid;
}

function slideTable(xml: string): RawCell[][] {
  const grid: RawCell[][] = [];
  for (const tr of blocks(xml, 'a:tr')) {
    const row: RawCell[] = [];
    for (const tc of blocks(tr, 'a:tc')) {
      if (/^<a:tc[^>]*\bhMerge="1"/.test(tc)) { row.push(row[row.length - 1] ?? null); continue; }
      if (/^<a:tc[^>]*\bvMerge="1"/.test(tc)) { row.push(grid[grid.length - 1]?.[row.length] ?? null); continue; }
      row.push(cellText(tc, 'a:p', 'a:t') || null);
    }
    grid.push(row);
  }
  return grid;
}

const square = (grid: RawCell[][]) => {
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.map((r) => [...r, ...new Array<RawCell>(width - r.length).fill(null)]);
};

export async function readOfficeTables(buf: ArrayBuffer, source: string): Promise<RawTable[]> {
  const zip = await JSZip.loadAsync(buf);
  const out: RawTable[] = [];
  const word = zip.file('word/document.xml');
  if (word) {
    const tables = blocks(await word.async('string'), 'w:tbl');
    tables.forEach((t, i) => out.push(...gridToTables(square(wordTable(t)), tables.length > 1 ? `Table ${i + 1}` : 'Table', source)));
    return out.filter((t) => t.rows.length > 0);
  }
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  for (const f of slides) {
    const xml = await zip.file(f)!.async('string');
    const tables = blocks(xml, 'a:tbl');
    const n = f.match(/\d+/)![0];
    tables.forEach((t, i) => out.push(...gridToTables(square(slideTable(t)), `Slide ${n}${tables.length > 1 ? ` table ${i + 1}` : ''}`, source)));
  }
  return out.filter((t) => t.rows.length > 0);
}

/** True for a Word or PowerPoint file, judged from the parts inside the zip rather than the file name alone. */
export async function isOfficeDocument(buf: ArrayBuffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buf);
  return Boolean(zip.file('word/document.xml') || zip.file('ppt/presentation.xml'));
}
