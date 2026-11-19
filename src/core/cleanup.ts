// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { isLikelyTypo } from './typos';

/**
 * Entry cleanup: corrects how text was typed, before anything is counted.
 * "BAROTAC NUEVO," and ",barotac nuevo" both become "BAROTAC NUEVO". Every change has a reason,
 * so it can be listed, reviewed, and switched off.
 */

export type CleanReason = 'extra spaces' | 'stray characters' | 'letter case' | 'spelling variant' | 'likely typo';

export interface ValueFix { from: string; to: string; reason: CleanReason; count: number }

export interface CleanOptions {
  /** Merge labels that differ only in letter case, spacing, accents, or punctuation. */
  variants: boolean;
  /** Write entries in capitals when almost every entry in the column already is. */
  matchCase: boolean;
  /** Merge a rare label one typing slip away from a far more common label. */
  typos: boolean;
}

export const FULL_CLEANUP: CleanOptions = { variants: true, matchCase: true, typos: true };
/** IDs and phone numbers only lose stray spaces and punctuation. Their letters are never changed. */
export const TIDY_ONLY: CleanOptions = { variants: false, matchCase: false, typos: false };

const SPACES = /\s+/g;
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const LEAD = /^(?:[,;:|_*~^=`]|\.(?!\d)|\p{Pd}(?!\d))+\s*/u;
const TRAIL = /\s*(?:[,;:|_*~^=`]|\s\p{Pd}|\p{Pd}{2,})+$/u;
/** A slash at either end is removed only when a real word is left, so "/A" and "N/" are not cut down to one letter. */
const SLASH_EDGE = /^[\\/]+\s*|\s*[\\/]+$/g;
const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
const QUOTES = ['"', "'", ...[0x201c, 0x201d, 0x2018, 0x2019].map((c) => String.fromCharCode(c))];
const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);
const spaced = (s: string) => s.replace(SPACES, ' ').replace(INVISIBLE, '').trim();

function stripUnbalancedQuotes(s: string): string {
  let out = s;
  for (const q of QUOTES) {
    const n = out.split(q).length - 1;
    if (n === 1 && (out.startsWith(q) || out.endsWith(q))) out = out.startsWith(q) ? out.slice(1) : out.slice(0, -1);
  }
  return out;
}

/** Removes invisible characters, repeated spaces, and stray punctuation at either end. Letters are never changed. */
export function tidyText(input: string): string {
  const start = spaced(input);
  if (!hasWord(start)) return start;
  let s = start;
  for (let guard = 0; guard < 4; guard++) {
    let next = stripUnbalancedQuotes(s.replace(LEAD, '').replace(TRAIL, '')).trim();
    const unslashed = next.replace(SLASH_EDGE, '').trim();
    if (unslashed !== next && letters(unslashed) >= 3) next = unslashed;
    if (next === s || !hasWord(next)) break;
    s = next;
  }
  return s;
}

/** Labels with the same key are the same entry written differently. */
export function variantKey(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(?<=\p{L})-(?=\p{L})/gu, ' ')
    .replace(/[.,;:'"_~*!?\\|\p{Pi}\p{Pf}\p{Sk}]+/gu, ' ')
    .replace(/\s*([/&+#%()-])\s*/g, '$1')
    .replace(SPACES, ' ').trim();
}

const isCaps = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
const punctuation = (s: string) => (s.match(/[^\p{L}\p{N}\s]/gu) ?? []).length;

function reasonFor(original: string, tidy: string, to: string): CleanReason {
  const start = spaced(original);
  if (to === start) return 'extra spaces';
  if (tidy !== start && tidy.toLowerCase() === to.toLowerCase()) return 'stray characters';
  if (tidy.toLowerCase() === to.toLowerCase()) return 'letter case';
  return 'spelling variant';
}

/**
 * Decides the correct spelling for every distinct entry in one column.
 * Works on distinct values and their counts, so a column of any length is planned in one pass.
 */
export function planCleanup(counts: Map<string, number>, opts: CleanOptions, context?: Map<string, Set<string>>): Map<string, { to: string; reason: CleanReason }> {
  const tidy = new Map<string, string>();
  counts.forEach((_, v) => tidy.set(v, tidyText(v)));

  // Letter case of the column, weighted by how often each entry appears.
  let caps = 0;
  let lettered = 0;
  let length = 0;
  let total = 0;
  counts.forEach((n, v) => {
    const t = tidy.get(v)!;
    total += n;
    length += t.length * n;
    if (!/\p{L}/u.test(t)) return;
    lettered += n;
    if (isCaps(t)) caps += n;
  });
  const capsColumn = opts.matchCase && lettered >= 20 && caps / lettered >= 0.9 && length / Math.max(1, total) <= 60;
  // Short labels follow the column style. Sentences keep the letter case they were written in.
  const styled = (s: string) => (capsColumn && s.length <= 40 ? s.toUpperCase() : s);
  const keyOf = (s: string) => (opts.variants ? variantKey(s) || s : s);

  // Group spellings of the same entry, then keep the most common spelling of each group.
  const groups = new Map<string, Map<string, number>>();
  counts.forEach((n, v) => {
    const t = styled(tidy.get(v)!);
    const g = groups.get(keyOf(t)) ?? new Map<string, number>();
    g.set(t, (g.get(t) ?? 0) + n);
    groups.set(keyOf(t), g);
  });
  const mainOf = new Map<string, { main: string; n: number }>();
  groups.forEach((g, key) => {
    const ranked = [...g].sort((a, b) => b[1] - a[1]
      || Number(isCaps(b[0]) === capsColumn) - Number(isCaps(a[0]) === capsColumn)
      || punctuation(a[0]) - punctuation(b[0])
      || (a[0] < b[0] ? -1 : 1));
    mainOf.set(key, { main: ranked[0][0], n: [...g.values()].reduce((a, b) => a + b, 0) });
  });

  // A rare entry one typing slip from a much more common entry is the same entry. With a context,
  // such as the municipality of a barangay, both spellings must also appear in the same place.
  const typoTo = new Map<string, string>();
  const placesOf = new Map<string, Set<string>>();
  context?.forEach((set, v) => {
    if (!tidy.has(v)) return;
    const k = keyOf(styled(tidy.get(v)!));
    const all = placesOf.get(k) ?? new Set<string>();
    set.forEach((x) => all.add(x));
    placesOf.set(k, all);
  });
  const samePlace = (a: string, b: string) => {
    if (!context) return true;
    const [x, y] = [placesOf.get(a), placesOf.get(b)];
    return Boolean(x && y && [...x].some((p) => y.has(p)));
  };
  if (opts.typos && mainOf.size > 1) {
    const all = [...mainOf].map(([key, x]) => ({ key, ...x }));
    const common = all.filter((x) => x.n >= 20);
    for (const rare of all) {
      const hits = common.filter((o) => o !== rare && o.n >= Math.max(20, rare.n * 20) && isLikelyTypo(rare.key, o.key) && samePlace(rare.key, o.key));
      if (hits.length === 1) typoTo.set(rare.key, hits[0].key);
    }
  }

  const out = new Map<string, { to: string; reason: CleanReason }>();
  counts.forEach((_, v) => {
    const t = tidy.get(v)!;
    const key = keyOf(styled(t));
    const typo = typoTo.get(key);
    const to = mainOf.get(typo ?? key)!.main;
    if (to === v) return;
    out.set(v, { to, reason: typo ? 'likely typo' : reasonFor(v, t, to) });
  });
  return out;
}

/** One line per distinct change, most frequent first. */
export function listFixes(counts: Map<string, number>, plan: Map<string, { to: string; reason: CleanReason }>): ValueFix[] {
  return [...plan].map(([from, p]) => ({ from, to: p.to, reason: p.reason, count: counts.get(from) ?? 0 }))
    .sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1));
}
