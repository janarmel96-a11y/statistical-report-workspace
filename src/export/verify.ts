// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type { WorkbookInput } from './workbook';

export class BrokenFileError extends Error {}

const REQUIRED = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml'];

/**
 * Opens the finished file from scratch and checks its structure and contents.
 * A file that fails any check is never offered for download.
 */
export async function verifyWorkbook(buf: ArrayBuffer, input: WorkbookInput): Promise<void> {
  const fail = (m: string): never => { throw new BrokenFileError(`The workbook failed its safety check: ${m}`); };
  const zip = await JSZip.loadAsync(buf);
  for (const part of REQUIRED) if (!zip.file(part)) fail(`missing ${part}`);

  const types = await zip.file('[Content_Types].xml')!.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  for (const m of rels.matchAll(/Target="([^"]+)"/g)) {
    const target = m[1].startsWith('/') ? m[1].slice(1) : `xl/${m[1]}`;
    if (!zip.file(target)) fail(`broken link to ${target}`);
  }
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name) || zip.files[name].dir) continue;
    const text = await zip.file(name)!.async('string');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) fail(`illegal characters in ${name}`);
    if (/<v>(NaN|Infinity|-Infinity|undefined|null)<\/v>/.test(text)) fail(`invalid number in ${name}`);
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) fail(`malformed XML in ${name}`);
    }
    if (name.startsWith('xl/worksheets/sheet') && !types.includes(`/${name}`)) fail(`${name} is not registered`);
  }

  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellFormula: true });
  const names = wb.SheetNames;
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) fail('duplicate sheet names');
  for (const n of names) if (n.length > 31 || /[\\/*?:[\]]/.test(n)) fail(`illegal sheet name ${n}`);
  if (!names.includes('Summary') || !names.includes('Data')) fail('required sheets are missing');

  const data = wb.Sheets.Data;
  const range = XLSX.utils.decode_range(data['!ref'] ?? 'A1:A1');
  const written = range.e.r - 2; // title, note, header occupy the first three rows
  const expected = Math.min(input.rows.length, written);
  if (input.rows.length > 0 && written !== expected) fail('row count does not match');
  if (input.rows.length > 0 && written <= 0) fail('the data sheet is empty');

  // Every numeric column must add up to the same total as the report.
  input.data.columns.forEach((c, col) => {
    if (c.type !== 'number') return;
    let source = 0;
    let saved = 0;
    for (let i = 0; i < written; i++) {
      const v = c.values[input.rows[i]];
      if (typeof v === 'number' && Number.isFinite(v)) source += v;
      const cell = data[XLSX.utils.encode_cell({ r: 3 + i, c: col })];
      if (cell && typeof cell.v === 'number') saved += cell.v;
    }
    if (Math.abs(source - saved) > Math.max(1e-6, Math.abs(source) * 1e-9)) fail(`${c.name} total changed during export`);
  });
}
