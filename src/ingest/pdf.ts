// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { RawTable } from '../core/types';
import { pageTablesToRaw, tablesOnPage, type PageTable, type TextBox } from './pdfTables';

export type Progress = (message: string, fraction: number) => void;

const asset = (p: string) => new URL(p, document.baseURI).href;

export async function readPdf(buf: ArrayBuffer, source: string, onProgress: Progress): Promise<RawTable[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // Scripts embedded in PDFs are never run.
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), enableXfa: false });
  const doc = await task.promise;
  const tables: PageTable[] = [];
  const scanned: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress(`Reading page ${p} of ${doc.numPages}`, (p - 1) / doc.numPages);
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boxes: TextBox[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      boxes.push({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5] - h, w: it.width, h });
    }
    if (boxes.length < 8) scanned.push(p);
    else tables.push(...tablesOnPage(boxes, p));
  }

  let usedOcr = false;
  if (scanned.length) {
    usedOcr = true;
    onProgress('Starting text recognition for scanned pages', 0);
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      workerPath: asset('ocr/worker.min.js'), corePath: asset('ocr/'), langPath: asset('ocr/'), gzip: true, workerBlobURL: false,
    });
    try {
      for (let i = 0; i < scanned.length; i++) {
        const p = scanned[i];
        onProgress(`Recognizing scanned page ${i + 1} of ${scanned.length}`, i / scanned.length);
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
        const { data } = await worker.recognize(canvas, {}, { blocks: true });
        const boxes: TextBox[] = [];
        for (const block of data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) for (const w of line.words) {
          if (!w.text.trim()) continue;
          boxes.push({ str: w.text, x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0, conf: w.confidence / 100 });
        }
        tables.push(...tablesOnPage(boxes, p));
      }
    } finally {
      await worker.terminate();
    }
  }
  await task.destroy();
  tables.sort((a, b) => a.page - b.page);
  return pageTablesToRaw(tables, source, usedOcr);
}
