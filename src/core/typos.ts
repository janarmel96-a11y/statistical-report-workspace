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
