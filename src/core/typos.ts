// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.

/** True for one missing, extra, or swapped letter. A replaced letter is not enough, because Bago and Bato are different places. */
function oneTypo(a: string, b: string) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 5 || long.length - short.length > 1 || a === b) return false;
  if (/\d/.test(long) || /^[ivxlcdm]+$/.test(short) || /^[ivxlcdm]+$/.test(long)) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (long.length > short.length) return long.slice(i + 1) === short.slice(i);
  return short[i] === long[i + 1] && short[i + 1] === long[i] && short.slice(i + 2) === long.slice(i + 2);
}

/** Labels match when every word is the same except one word with a single typing slip. */
export function isLikelyTypo(a: string, b: string) {
  const [x, y] = [a.split(' '), b.split(' ')];
  if (x.length !== y.length) return false;
  const differ = x.flatMap((w, i) => (w === y[i] ? [] : [i]));
  return differ.length === 1 && oneTypo(x[differ[0]], y[differ[0]]);
}

/* ---------- Similar entries ---------- */

/** Letters that sound alike in Filipino and Spanish spellings, so one is often typed for the other. */
const SOUND_ALIKE = ['bv', 'ck', 'cs', 'sz', 'fp', 'jh', 'ie', 'ou', 'iy', 'nm', 'qk', 'xs'];
const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const alike = new Set<string>();
for (const p of SOUND_ALIKE) { alike.add(p); alike.add(p[1] + p[0]); }
const adjacent = new Set<string>();
KEYBOARD.forEach((row, r) => {
  for (let i = 0; i < row.length; i++) {
    const around = [row[i - 1], row[i + 1], KEYBOARD[r - 1]?.[i], KEYBOARD[r - 1]?.[i + 1], KEYBOARD[r + 1]?.[i], KEYBOARD[r + 1]?.[i - 1]];
    for (const o of around) if (o) adjacent.add(row[i] + o);
  }
});
/**
 * A replaced letter counts as a slip only when the two letters sound alike (in words of 5 letters or more, as in
 * NUEBO for NUEVO) or sit next to each other on the keyboard (in words of 6 letters or more, as in ILOILI for ILOILO).
 */
const replaceable = (a: string, b: string, length: number) => (length >= 5 && alike.has(a + b)) || (length >= 6 && adjacent.has(a + b));

/** Words that are often shortened in place names. A shortened word and the full word are the same entry. */
const ABBREVIATIONS: Record<string, string> = { sta: 'santa', sto: 'santo', sn: 'san', pob: 'poblacion', gen: 'general', pres: 'president', brgy: '', bgy: '', barangay: '' };

const words = (s: string) => s.split(' ').map((w) => ABBREVIATIONS[w] ?? w).filter(Boolean);
const isInitial = (w: string) => w.length === 1 && /\p{L}/u.test(w);
const isNumeral = (w: string) => /\d/.test(w) || /^[ivxlcdm]+$/.test(w);

/**
 * Typing slips between two words: missing, extra, or swapped letters cost 1, and so does a replaced letter that
 * sounds alike or sits next to the right key. Any other difference returns Infinity. Short words must match exactly,
 * a replaced letter needs a word of at least 6 letters, and two slips need at least 8.
 */
export function slips(a: string, b: string): number {
  if (a === b) return 0;
  const shortest = Math.min(a.length, b.length);
  if (shortest < 5 || Math.abs(a.length - b.length) > 2 || isNumeral(a) || isNumeral(b)) return Infinity;
  const allowed = (cost: number) => (cost === 1 || (cost === 2 && shortest >= 8) ? cost : Infinity);
  if (a.length === b.length) {
    // Same length: only swapped neighbors and confusable letters. A deletion plus an insertion would let any letter be replaced.
    let cost = 0;
    for (let i = 0; i < a.length && cost <= 2;) {
      if (a[i] === b[i]) i++;
      else if (a[i] === b[i + 1] && a[i + 1] === b[i]) { cost++; i += 2; }
      else if (replaceable(a[i], b[i], shortest)) { cost++; i++; }
      else return Infinity;
    }
    return allowed(cost);
  }
  // Different lengths: Damerau distance in which only confusable letters may be replaced.
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      const replace = same ? 0 : replaceable(a[i - 1], b[j - 1], shortest) ? 1 : Infinity;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + replace);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return allowed(d[a.length][b.length]);
}

/**
 * Looser than `isLikelyTypo`, for entries that are clearly the same once you look closely:
 * a replaced letter that sounds alike or is next to the right key (BAROTAC NUEBO, ILOILI), up to two slips in total
 * (BAROTCA NEUVO), a missing or extra space (TABUCSUBA, DUE AS for DUEÑAS), a shortened word (STA. BARBARA,
 * POB. NORTE), a missing middle initial, or names written in another order (MICHELLE A. SALVADOR).
 * Both labels must already be written as `variantKey` writes them. Numbers must always agree.
 */
export function isSimilarEntry(a: string, b: string): boolean {
  if (a === b) return false;
  const [x, y] = [words(a), words(b)];
  const [cx, cy] = [x.join(''), y.join('')];
  if (cx === cy) return true;
  const digits = (s: string) => s.replace(/\D+/g, ' ').trim();
  if (digits(a) !== digits(b)) return false;
  // Names written in another order, or missing a middle initial. Only the rare entry `a` may lack an initial:
  // an extra letter can be real, as in POBLACION A, POBLACION B, and MERCED N.
  const full = (ws: string[]) => ws.filter((w) => !isInitial(w)).sort().join(' ');
  if (x.length >= 2 && y.length >= 2 && full(x) === full(y) && full(x).includes(' ')) {
    const [ix, iy] = [x.filter(isInitial), y.filter(isInitial)];
    if (ix.every((i) => iy.includes(i))) return true;
  }
  if (Math.abs(cx.length - cy.length) > 2) return false;
  if (x.length === y.length) {
    let cost = 0;
    for (let i = 0; i < x.length && cost <= 2; i++) cost += slips(x[i], y[i]);
    if (cost <= 2 && (cost < 2 || cx.length >= 8)) return true;
  }
  // A missing or extra space, possibly with one more slip. Not around a single letter: POBLACION A is not POBLACION.
  return x.length !== y.length && !x.some(isInitial) && !y.some(isInitial) && Math.max(cx.length, cy.length) >= 6 && slips(cx, cy) <= 1;
}
