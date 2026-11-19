// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { RawCell, RawTable } from '../core/types';
import type { Progress } from './pdf';

export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export const ACCEPT = '.xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt,.json,.ndjson,.pdf,.docx,.pptx,.htm,.html,.statsecure';

export class ImportError extends Error {}

function signature(bytes: Uint8Array): 'zip' | 'ole' | 'pdf' | 'other' {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return 'ole';
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  return 'other';
}

/** Reads any supported file. The file's content decides the parser, not just its extension. */
export async function readFile(file: File, onProgress: Progress): Promise<RawTable[]> {
  return (await readFileWithGrids(file, onProgress, () => false)).tables;
}

/** Reads any supported file, and also keeps the exact cell layout of the spreadsheet sheets that `keep` selects. */
export async function readFileWithGrids(file: File, onProgress: Progress, keep: (sheetName: string) => boolean): Promise<{ tables: RawTable[]; grids: Map<string, RawCell[][]> }> {
  let grids = new Map<string, RawCell[][]>();
  if (file.size === 0) throw new ImportError(`${file.name} is empty.`);
  if (file.size > MAX_FILE_BYTES) throw new ImportError(`${file.name} is larger than the 200 MB limit.`);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const buf = await file.arrayBuffer();
  const sig = signature(new Uint8Array(buf.slice(0, 8)));
  onProgress(`Reading ${file.name}`, 0.1);
  let tables: RawTable[];
  try {
    const { decodeText, readCsv, readJson, readWorkbookWithGrids } = await import('./readers');
    const readWorkbook = (b: ArrayBuffer, name: string) => { const r = readWorkbookWithGrids(b, name, keep); grids = r.grids; return r.tables; };
    if (sig === 'pdf') {
      const { readPdf } = await import('./pdf');
      tables = await readPdf(buf, file.name, onProgress);
    } else if (sig === 'zip' && (['docx', 'pptx'].includes(ext) || !['xlsx', 'xlsm', 'xlsb', 'ods'].includes(ext))) {
      // Word and PowerPoint reports are zip files too; their tables are read from the document itself.
      const { isOfficeDocument, readOfficeTables } = await import('./office');
      tables = await isOfficeDocument(buf) ? await readOfficeTables(buf, file.name) : readWorkbook(buf, file.name);
    } else if (sig === 'zip' || sig === 'ole') {
      tables = readWorkbook(buf, file.name);
    } else if (['htm', 'html'].includes(ext)) {
      tables = readWorkbook(buf, file.name); // Tables of a saved web page
    } else if (ext === 'json' || ext === 'ndjson') {
      tables = readJson(decodeText(buf), file.name);
    } else if (['csv', 'tsv', 'txt'].includes(ext)) {
      tables = readCsv(decodeText(buf), file.name);
    } else if (['xls', 'xlsx', 'xlsm'].includes(ext)) {
      tables = readWorkbook(buf, file.name); // Older spreadsheet XML or HTML saved as .xls
    } else {
      throw new ImportError(`${file.name} is not a supported file. Use Excel, OpenDocument, CSV, JSON, PDF, Word, PowerPoint, or a web page.`);
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`${file.name} could not be read. It may be damaged or password protected.`);
  }
  if (!tables.length) {
    throw new ImportError(sig === 'pdf'
      ? `No tables were found in ${file.name}. The PDF may contain only paragraphs or images of charts.`
      : ['docx', 'pptx'].includes(ext) ? `No tables were found in ${file.name}. Charts and pictures cannot be read; add the numbers as a table.`
      : `No table of data was found in ${file.name}.`);
  }
  return { tables, grids };
}
