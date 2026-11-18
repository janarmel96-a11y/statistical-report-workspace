// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.

/** Prepares a script for a professional spoken delivery. Free of browser APIs so it can be tested. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const QUARTER = ['first', 'second', 'third', 'fourth'];
const SCALE: Record<string, string> = { K: 'thousand', M: 'million', B: 'billion', T: 'trillion' };
const MONEY: Record<string, string> = { $: 'dollars', '₱': 'pesos', '€': 'euros', '£': 'pounds', '¥': 'yen', '₹': 'rupees' };

/** Rewrites figures the way a presenter says them, for example $79.4K as 79.4 thousand dollars. */
export function spokenText(input: string): string {
  return input
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`)
    .replace(/\bQ([1-4])\s+(\d{4})\b/g, (_, q, y) => `the ${QUARTER[Number(q) - 1]} quarter of ${y}`)
    .replace(new RegExp(`\\b(${SHORT})\\s+(\\d{4})\\b`, 'g'), (_, m, y) => `${MONTHS.findIndex((x) => x.startsWith(m))>= 0 ? MONTHS[MONTHS.findIndex((x) => x.startsWith(m))] : m} ${y}`)
    .replace(/(-?)([$₱€£¥₹])\s?(\d[\d,]*(?:\.\d+)?)([KMBT])?\b/g, (_, sign, cur, n, s) => `${sign ? 'minus ' : ''}${n}${s ? ` ${SCALE[s]}` : ''} ${MONEY[cur]}`)
    .replace(/\b(\d[\d,]*(?:\.\d+)?)([KMBT])\b/g, (_, n, s) => `${n} ${SCALE[s]}`)
    .replace(/\bp\s*<\s*(\d)/g, 'a p value below $1')
    .replace(/\bp\s*=\s*(\d)/g, 'a p value of $1')
    .replace(/\br\s*=\s*(-?\d)/g, 'a correlation of $1')
    .replace(/(\d)\s?%/g, '$1 percent')
    .replace(/\b(\d{1,3})-(\d{1,3})\b/g, '$1 to $2')
    .replace(/(\p{L})-(?=\p{L})/gu, '$1 ')
    .replace(/\bvs\.?(?=\s)/gi, 'versus')
    .replace(/\bYoY\b/g, 'year over year')
    .replace(/\bN\/A\b/g, 'not available')
    .replace(/×/g, ' by ')
    .replace(/÷/g, ' divided by ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short sentences keep browser voices from stopping partway through a long passage. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.trim().split(/(?<=[.!?])\s+(?=[\p{Lu}\d"$₱€£])/u)) {
    if (sentence.length <= 170) { if (sentence.trim()) out.push(sentence.trim()); continue; }
    let part = '';
    for (const piece of sentence.split(/(?<=[,;:])\s+/)) {
      if (part && part.length + piece.length > 170) { out.push(part); part = piece; } else part = part ? `${part} ${piece}` : piece;
    }
    if (part) out.push(part);
  }
  return out;
}

/** Where each sentence begins within a scene, so captions stay with the voice. */
export function sentenceOffsets(sentences: string[], seconds: number): number[] {
  const words = sentences.map((s) => s.split(/\s+/).length);
  const total = words.reduce((a, b) => a + b, 0) || 1;
  const usable = Math.max(0.5, seconds - 0.6);
  const out = [0.2];
  words.forEach((w) => out.push(out[out.length - 1] + (w / total) * usable));
  return out;
}

/** A measured, presenter-like speed. */
export const speechRate = (pace: number) => Math.max(0.8, Math.min(1.25, pace / 2.6));

/** Chooses the clearest English voice installed on this device. */
export function bestVoice(voices: { name: string; lang: string }[]): string {
  const score = (v: { name: string; lang: string }) => (/natural|neural/i.test(v.name) ? 8 : 0) + (/(aria|jenny|guy|zira|david|mark|samantha|daniel|karen)/i.test(v.name) ? 4 : 0) + (/^en[-_]US/i.test(v.lang) ? 2 : /^en[-_](GB|PH|AU)/i.test(v.lang) ? 1 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0]?.name ?? 'off';
}
