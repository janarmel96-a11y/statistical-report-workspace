// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
// Copies the OCR engine into public/ocr so scanned PDFs are read without contacting any other server.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
mkdirSync(out, { recursive: true });

const copy = (from, name) => {
  if (!existsSync(from)) throw new Error(`Missing OCR asset: ${from}`);
  copyFileSync(from, join(out, name));
};

copy(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), 'worker.min.js');
const core = join(root, 'node_modules/tesseract.js-core');
for (const f of readdirSync(core)) {
  if (/^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(f)) copy(join(core, f), f);
}
const dataRoot = join(root, 'node_modules/@tesseract.js-data/eng');
const version = readdirSync(dataRoot).filter((d) => /^\d/.test(d)).sort().at(-1);
const candidates = [join(dataRoot, version, 'eng.traineddata.gz'), join(dataRoot, version, 'tessdata_fast', 'eng.traineddata.gz')];
const data = candidates.find(existsSync);
if (!data) throw new Error('English OCR language data was not found.');
copy(data, 'eng.traineddata.gz');
console.log('OCR assets ready in public/ocr');
