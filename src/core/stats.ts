/**
 * Statistics library. Definitions match Excel and SciPy so results can be checked against both:
 * quantile = PERCENTILE.INC, skewness = SKEW, kurtosis = KURT, stdev = STDEV.S.
 */

/** Neumaier compensated sum: avoids drift such as 0.1 + 0.2 + ... on long columns. */
export function sum(xs: ArrayLike<number>): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return s + c;
}

export function mean(xs: ArrayLike<number>): number {
  return xs.length ? sum(xs) / xs.length : NaN;
}

export function variance(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  const d = new Array<number>(n);
  for (let i = 0; i < n; i++) d[i] = (xs[i] - m) ** 2;
  return sum(d) / (n - 1);
}

export const stdev = (xs: ArrayLike<number>) => Math.sqrt(variance(xs));

export function sorted(xs: ArrayLike<number>): Float64Array {
  return Float64Array.from(xs as ArrayLike<number>).sort();
}

/** Linear-interpolated quantile on sorted data (Excel PERCENTILE.INC, NumPy default). */
export function quantileSorted(s: ArrayLike<number>, p: number): number {
  const n = s.length;
  if (!n) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}

export const quantile = (xs: ArrayLike<number>, p: number) => quantileSorted(sorted(xs), p);
export const median = (xs: ArrayLike<number>) => quantile(xs, 0.5);

/** Adjusted Fisher-Pearson skewness (Excel SKEW). */
export function skewness(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  const s = stdev(xs);
  if (!(s > 0)) return 0;
  let t = 0;
  for (let i = 0; i < n; i++) t += ((xs[i] - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * t;
}

/** Sample excess kurtosis (Excel KURT). */
export function kurtosis(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 4) return NaN;
  const m = mean(xs);
  const s = stdev(xs);
  if (!(s > 0)) return 0;
  let t = 0;
  for (let i = 0; i < n; i++) t += ((xs[i] - m) / s) ** 4;
  return (n * (n + 1) * t) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

/* ---------- special functions ---------- */

export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a;
    let s = 1 / a;
    let del = s;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      s += del;
      if (Math.abs(del) < Math.abs(s) * 1e-15) break;
    }
    return 1 - s * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Two-sided p-value for Student's t. */
export const tTwoSided = (t: number, df: number) => ibeta(df / (df + t * t), df / 2, 0.5);
export const chi2Upper = (x: number, df: number) => gammaQ(df / 2, x / 2);
export const fUpper = (f: number, d1: number, d2: number) => ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);

/** Two-sided normal p-value computed through the chi-square identity for accuracy in the tails. */
export const normalTwoSided = (z: number) => (z === 0 ? 1 : gammaQ(0.5, (z * z) / 2));

/** Critical t for a two-sided confidence level, by bisection. */
export function tCritical(confidence: number, df: number): number {
  const alpha = 1 - confidence;
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSided(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Interval { low: number; high: number; level: number }

export function meanCI(xs: ArrayLike<number>, level = 0.95): Interval | null {
  const n = xs.length;
  if (n < 2) return null;
  const e = (tCritical(level, n - 1) * stdev(xs)) / Math.sqrt(n);
  const m = mean(xs);
  return { low: m - e, high: m + e, level };
}

/** Wilson score interval for a proportion. */
export function proportionCI(successes: number, n: number, level = 0.95): Interval | null {
  if (n < 1) return null;
  const z = tCritical(level, 1e7);
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const e = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, c - e), high: Math.min(1, c + e), level };
}

/* ---------- association ---------- */

export interface CorrelationResult { r: number; p: number; n: number }

export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): CorrelationResult {
  const n = x.length;
  if (n < 3) return { r: NaN, p: NaN, n };
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { r: NaN, p: NaN, n };
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  if (Math.abs(r) === 1) return { r, p: 0, n };
  return { r, p: tTwoSided(r * Math.sqrt((n - 2) / (1 - r * r)), n - 2), n };
}

/** Average ranks, ties share their mean rank. */
export function ranks(xs: ArrayLike<number>): Float64Array {
  const n = xs.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const out = new Float64Array(n);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && xs[idx[j + 1]] === xs[idx[i]]) j++;
    for (let k = i; k <= j; k++) out[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export const spearman = (x: ArrayLike<number>, y: ArrayLike<number>) => pearson(ranks(x), ranks(y));

export interface LinearFit { slope: number; intercept: number; r2: number }

export function linearFit(x: ArrayLike<number>, y: ArrayLike<number>): LinearFit {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

/* ---------- hypothesis tests ---------- */

export interface TestResult {
  name: string;
  statistic: number;
  df?: number | [number, number];
  p: number;
  effect?: number;
  effectName?: string;
}

/** Welch's unequal-variance t-test (SciPy ttest_ind equal_var=False). */
export function welchT(a: ArrayLike<number>, b: ArrayLike<number>): TestResult {
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const t = (mean(a) - mean(b)) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const pooled = Math.sqrt(
    ((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / (a.length + b.length - 2),
  );
  return {
    name: "Welch's t-test", statistic: t, df, p: tTwoSided(t, df),
    effect: (mean(a) - mean(b)) / pooled, effectName: "Cohen's d",
  };
}

/** One-way ANOVA (SciPy f_oneway). */
export function anova(groups: ArrayLike<number>[]): TestResult {
  const k = groups.length;
  const n = groups.reduce((s, g) => s + g.length, 0);
  const grand = groups.reduce((s, g) => s + sum(g), 0) / n;
  let ssb = 0;
  let ssw = 0;
  for (const g of groups) {
    const m = mean(g);
    ssb += g.length * (m - grand) ** 2;
    for (let i = 0; i < g.length; i++) ssw += (g[i] - m) ** 2;
  }
  const d1 = k - 1;
  const d2 = n - k;
  const f = ssb / d1 / (ssw / d2);
  return {
    name: 'One-way ANOVA', statistic: f, df: [d1, d2], p: fUpper(f, d1, d2),
    effect: ssb / (ssb + ssw), effectName: 'Eta squared',
  };
}

/** Pearson chi-square test of independence (SciPy chi2_contingency correction=False). */
export function chiSquare(table: number[][]): TestResult {
  const rows = table.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = table[0].map((_, j) => table.reduce((a, r) => a + r[j], 0));
  const n = rows.reduce((a, b) => a + b, 0);
  let x2 = 0;
  table.forEach((r, i) =>
    r.forEach((o, j) => {
      const e = (rows[i] * cols[j]) / n;
      if (e > 0) x2 += (o - e) ** 2 / e;
    }),
  );
  const df = (table.length - 1) * (table[0].length - 1);
  const v = Math.sqrt(x2 / (n * Math.max(1, Math.min(table.length - 1, table[0].length - 1))));
  return { name: 'Chi-square test', statistic: x2, df, p: chi2Upper(x2, df), effect: v, effectName: "Cramér's V" };
}

/** Mann-Whitney U, normal approximation with tie and continuity correction (SciPy asymptotic). */
export function mannWhitney(a: ArrayLike<number>, b: ArrayLike<number>): TestResult {
  const n1 = a.length;
  const n2 = b.length;
  const all = Float64Array.from([...Array.from(a), ...Array.from(b)]);
  const r = ranks(all);
  let r1 = 0;
  for (let i = 0; i < n1; i++) r1 += r[i];
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const n = n1 + n2;
  const counts = new Map<number, number>();
  all.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let tie = 0;
  counts.forEach((t) => (tie += t ** 3 - t));
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tie / (n * (n - 1))));
  const u = Math.max(u1, n1 * n2 - u1);
  const z = sigma > 0 ? (u - (n1 * n2) / 2 - 0.5) / sigma : 0;
  return {
    name: 'Mann-Whitney U', statistic: u1, p: Math.min(1, normalTwoSided(z)),
    effect: (2 * u1) / (n1 * n2) - 1, effectName: 'Rank-biserial r',
  };
}

/** Kruskal-Wallis H with tie correction (SciPy kruskal). */
export function kruskalWallis(groups: ArrayLike<number>[]): TestResult {
  const all = Float64Array.from(groups.flatMap((g) => Array.from(g)));
  const n = all.length;
  const r = ranks(all);
  let h = 0;
  let at = 0;
  for (const g of groups) {
    let s = 0;
    for (let i = 0; i < g.length; i++) s += r[at++];
    h += (s * s) / g.length;
  }
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
  const counts = new Map<number, number>();
  all.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let tie = 0;
  counts.forEach((t) => (tie += t ** 3 - t));
  const c = 1 - tie / (n ** 3 - n);
  const hc = c > 0 ? h / c : 0;
  const df = groups.length - 1;
  return { name: 'Kruskal-Wallis H', statistic: hc, df, p: chi2Upper(hc, df) };
}

export interface MannKendall { s: number; z: number; p: number; tau: number; trend: 'up' | 'down' | 'none' }

/** Mann-Kendall trend test with tie-corrected variance and continuity correction. */
export function mannKendall(xs: ArrayLike<number>, alpha = 0.05): MannKendall {
  const n = xs.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(xs[j] - xs[i]);
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) counts.set(xs[i], (counts.get(xs[i]) ?? 0) + 1);
  let tie = 0;
  counts.forEach((t) => (tie += t * (t - 1) * (2 * t + 5)));
  const v = (n * (n - 1) * (2 * n + 5) - tie) / 18;
  const z = v > 0 ? (s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0) : 0;
  const p = normalTwoSided(z);
  return { s, z, p, tau: n > 1 ? s / ((n * (n - 1)) / 2) : 0, trend: p < alpha ? (z > 0 ? 'up' : 'down') : 'none' };
}

/** Benjamini-Hochberg adjusted p-values (false discovery rate control). */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
  const out = new Array<number>(m);
  let min = 1;
  order.forEach(([p, i], k) => {
    min = Math.min(min, (p * m) / (m - k));
    out[i] = min;
  });
  return out;
}

/* ---------- outliers and shape ---------- */

export interface OutlierResult { low: number; high: number; indices: number[] }

export function iqrOutliers(xs: ArrayLike<number>, k = 1.5): OutlierResult {
  const s = sorted(xs);
  const q1 = quantileSorted(s, 0.25);
  const q3 = quantileSorted(s, 0.75);
  const low = q1 - k * (q3 - q1);
  const high = q3 + k * (q3 - q1);
  const indices: number[] = [];
  for (let i = 0; i < xs.length; i++) if (xs[i] < low || xs[i] > high) indices.push(i);
  return { low, high, indices };
}

/** Iglewicz-Hoaglin modified z-score. Values above 3.5 are outliers. */
export function modifiedZOutliers(xs: ArrayLike<number>, threshold = 3.5): number[] {
  const m = median(xs);
  const dev = Float64Array.from(xs as ArrayLike<number>, (v) => Math.abs(v - m));
  const mad = median(dev);
  if (!(mad > 0)) return [];
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) if (Math.abs((0.6745 * (xs[i] - m)) / mad) > threshold) out.push(i);
  return out;
}

export interface HistogramBin { start: number; end: number; count: number }

/** Freedman-Diaconis bins on rounded edges, capped for readability. */
export function histogram(xs: ArrayLike<number>, maxBins = 30): HistogramBin[] {
  const s = sorted(xs);
  const n = s.length;
  if (!n) return [];
  const min = s[0];
  const max = s[n - 1];
  if (min === max) return [{ start: min, end: max, count: n }];
  const whole = s.every(Number.isInteger);
  const iqr = quantileSorted(s, 0.75) - quantileSorted(s, 0.25);
  const fd = iqr > 0 ? 2 * iqr * Math.cbrt(1 / n) : (max - min) / Math.ceil(Math.log2(n) + 1);
  const bins = Math.max(whole ? 1 : 4, Math.min(maxBins, Math.ceil((max - min) / fd)));
  const raw = whole ? Math.max((max - min) / maxBins, Math.min(1, (max - min) / bins)) : (max - min) / bins;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const stepSize = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((w) => w >= raw) ?? raw;
  const nice = whole ? Math.max(1, Math.ceil(stepSize)) : stepSize;
  const start = Math.floor(min / nice) * nice;
  // Whole numbers keep the maximum in its own bin. Continuous data closes the last bin at the maximum.
  const count = whole ? Math.floor((max - start) / nice) + 1 : Math.max(1, Math.ceil((max - start) / nice + 1e-9));
  const out: HistogramBin[] = Array.from({ length: count }, (_, i) => ({
    start: start + i * nice, end: start + (i + 1) * nice, count: 0,
  }));
  for (let i = 0; i < n; i++) {
    out[Math.min(count - 1, Math.floor((s[i] - start) / nice + 1e-9))].count++;
  }
  return out;
}

export interface BoxStats {
  min: number; q1: number; median: number; q3: number; max: number; low: number; high: number; outliers: number[];
}

export function boxStats(xs: ArrayLike<number>): BoxStats {
  const s = sorted(xs);
  const q1 = quantileSorted(s, 0.25);
  const q3 = quantileSorted(s, 0.75);
  const lf = q1 - 1.5 * (q3 - q1);
  const hf = q3 + 1.5 * (q3 - q1);
  const inside = Array.from(s).filter((v) => v >= lf && v <= hf);
  return {
    min: s[0], q1, median: quantileSorted(s, 0.5), q3, max: s[s.length - 1],
    low: inside[0] ?? q1, high: inside[inside.length - 1] ?? q3,
    outliers: Array.from(s).filter((v) => v < lf || v > hf).slice(0, 200),
  };
}

/* ---------- forecasting ---------- */

export interface Forecast {
  values: number[];
  low: number[];
  high: number[];
  /** Mean absolute percentage error from a holdout backtest, or null when too short. */
  mape: number | null;
  method: string;
}

function holtFit(y: number[], season: number, alpha: number, beta: number, gamma: number, phi: number) {
  const m = season;
  let level = m ? mean(y.slice(0, m)) : y[0];
  let trend = m && y.length >= 2 * m ? (mean(y.slice(m, 2 * m)) - mean(y.slice(0, m))) / m : y.length > 1 ? y[1] - y[0] : 0;
  const seas = m ? y.slice(0, m).map((v) => v - level) : [];
  const res: number[] = [];
  const start = m || 1;
  for (let t = start; t < y.length; t++) {
    const s = m ? seas[t % m] : 0;
    const f = level + phi * trend + s;
    res.push(y[t] - f);
    const prev = level;
    level = alpha * (y[t] - s) + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prev) + (1 - beta) * phi * trend;
    if (m) seas[t % m] = gamma * (y[t] - level) + (1 - gamma) * s;
  }
  const predict = (h: number) => {
    let damp = 0;
    for (let i = 1; i <= h; i++) damp += phi ** i;
    return level + damp * trend + (m ? seas[(y.length + h - 1) % m] : 0);
  };
  return { res, predict };
}

function bestHolt(y: number[], season: number) {
  let best: ReturnType<typeof holtFit> | null = null;
  let bestSse = Infinity;
  for (const a of [0.1, 0.3, 0.5, 0.7, 0.9])
    for (const b of [0.01, 0.1, 0.3])
      for (const g of season ? [0.05, 0.2, 0.4] : [0]) {
        const f = holtFit(y, season, a, b, g, 0.95);
        const sse = f.res.reduce((s, e) => s + e * e, 0);
        if (sse < bestSse) { bestSse = sse; best = f; }
      }
  return best!;
}

/** Damped Holt(-Winters) with an empirical 95% band and a holdout backtest. */
export function forecast(y: number[], horizon: number, season = 0): Forecast | null {
  if (y.length < 6) return null;
  const m = season && y.length >= 2 * season + 2 ? season : 0;
  const fit = bestHolt(y, m);
  const sd = Math.sqrt(fit.res.reduce((s, e) => s + e * e, 0) / Math.max(1, fit.res.length));
  const values: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const v = fit.predict(h);
    const w = 1.96 * sd * Math.sqrt(h);
    values.push(v); low.push(v - w); high.push(v + w);
  }
  const hold = Math.min(horizon, Math.floor(y.length / 4));
  let mape: number | null = null;
  if (hold >= 1 && y.length - hold >= 6) {
    const train = y.slice(0, y.length - hold);
    const tm = m && train.length >= 2 * m + 2 ? m : 0;
    const bt = bestHolt(train, tm);
    const errs: number[] = [];
    for (let h = 1; h <= hold; h++) {
      const actual = y[train.length + h - 1];
      if (actual !== 0) errs.push(Math.abs((actual - bt.predict(h)) / actual));
    }
    mape = errs.length ? mean(errs) : null;
  }
  return { values, low, high, mape, method: m ? 'Damped Holt-Winters' : 'Damped Holt trend' };
}
