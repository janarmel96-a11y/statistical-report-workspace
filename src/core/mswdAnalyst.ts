// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { AnalystForecast, KeyNumber } from './analyst';
import { DAY, monthRange, philippineHolidays, workingDays, type MswdCheck, type MswdReport, type Prepared } from './mswd';
import { chiSquare, forecast, mannKendall, mean, stdev } from './stats';

/**
 * The AI summary of an MSWD performance report: how patient numbers move, what to expect next month,
 * who carries the workload, who needs attention, and how the patient mix shifts. Worked out on this device.
 */

export interface MswdBrief {
  headline: string;
  sections: { heading: string; lines: string[] }[];
  keyNumbers: KeyNumber[];
  /** Patients per complete month, with the next months forecast. */
  forecast?: AnalystForecast;
  monthly: { label: string; value: number; partial: boolean }[];
  /** Patients per RSW in the latest complete month, largest first. */
  workload?: { month: string; rows: { label: string; value: number }[] };
  /** Share of NEW and OLD patients in each month. */
  mix?: { months: string[]; newShare: number[]; oldShare: number[] };
}

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0 })}%`;
const pText = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
/** A name followed by a full stop, without doubling the stop of an initial such as "B.". */
const end = (name: string) => name.replace(/\.$/, '');
const title = (label: string) => label.split(' ').map((w) => (/^\d+$/.test(w) ? w : w[0] + w.slice(1).toLowerCase())).join(' ');

export function analyzeMswd(p: Prepared, report: MswdReport, checks: MswdCheck[]): MswdBrief {
  const months = report.months;
  const blocks = report.blocks.slice(0, months.length);
  const overall = report.blocks[report.blocks.length - 1];
  const partial = months.length && months[months.length - 1].partial ? months.length - 1 : -1;
  const full = blocks.map((b, i) => ({ b, m: months[i], i })).filter((x) => x.i !== partial);
  const sections: MswdBrief['sections'] = [];
  const actions: string[] = [];
  const total = overall.total.total;
  const active = overall.lines.filter((l) => l.total > 0);

  /* ---------- Patient numbers ---------- */
  const numbers: string[] = [];
  const keyNumbers: KeyNumber[] = [{ label: 'Patients catered', value: n(total), note: `${active.length} RSWs, ${months.length} months` }];
  let fc: AnalystForecast | undefined;
  const monthName = (key: number) => new Date(key).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  numbers.push(`${n(total)} patients were catered by ${active.length} RSWs${months.length ? ` from ${title(months[0].label)} to ${title(months[months.length - 1].label)}` : ''}${full.length ? `, an average of ${n(mean(full.map((x) => x.b.total.total)))} per complete month` : ''}.`);
  let expected: number | null = null;
  if (full.length) keyNumbers.push({ label: 'Average per month', value: n(mean(full.map((x) => x.b.total.total))), note: `${full.length} complete months` });
  if (full.length >= 2) {
    const [prev, last] = [full[full.length - 2], full[full.length - 1]];
    const change = prev.b.total.total ? (last.b.total.total - prev.b.total.total) / prev.b.total.total : 0;
    keyNumbers.push({ label: title(last.m.label), value: n(last.b.total.total), note: `${change >= 0 ? 'Up' : 'Down'} ${pct(Math.abs(change))} on ${title(prev.m.label)}`, tone: change > 0.005 ? 'up' : change < -0.005 ? 'down' : 'flat' });
    numbers.push(`${title(last.m.label)} had ${n(last.b.total.total)} patients, ${change >= 0 ? 'up' : 'down'} ${pct(Math.abs(change))} from ${n(prev.b.total.total)} in ${title(prev.m.label)}.`);
    if (change <= -0.15) actions.push(`Find out why patients fell ${pct(Math.abs(change))} in ${title(last.m.label)}: check for holidays, staff leave, or missing form submissions.`);
  }
  if (full.length >= 4) {
    const values = full.map((x) => x.b.total.total);
    const mk = mannKendall(values);
    numbers.push(mk.trend === 'none'
      ? `Monthly totals have no steady rise or fall (Mann-Kendall ${pText(mk.p)}).`
      : `Monthly totals show a statistically significant ${mk.trend === 'up' ? 'rise' : 'fall'} (Mann-Kendall ${pText(mk.p)}).`);
    if (full.length >= 6) {
      const out = forecast(values, 3);
      const nextKey = (monthRange(full[full.length - 1].m.label)?.to ?? 0) + DAY;
      const nextLabel = monthName(nextKey);
      if (out) {
        expected = Math.max(0, out.values[0]);
        const text = `Forecast for ${nextLabel}: about ${n(expected)} patients (95% range ${n(Math.max(0, out.low[0]))} to ${n(out.high[0])}; ${out.method}${out.mape !== null ? `, backtest error about ${pct(out.mape)}` : ''}).`;
        numbers.push(text);
        const labels = [0, 1, 2].map((h) => { const d = new Date(nextKey); return monthName(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + h, 1)); });
        fc = {
          history: full.map((x) => ({ label: title(x.m.label), value: x.b.total.total })), labels,
          values: out.values.map((v) => Math.max(0, v)), low: out.low.map((v) => Math.max(0, v)), high: out.high.map((v) => Math.max(0, v)),
          method: out.method, mape: out.mape, text,
        };
        keyNumbers.push({ label: `Forecast ${nextLabel}`, value: n(expected), note: `95% range ${n(Math.max(0, out.low[0]))} to ${n(out.high[0])}` });
      }
    }
  }
  // A partial month is projected from the working days it already covers.
  if (partial >= 0) {
    const m = months[partial];
    const range = monthRange(m.label);
    const lastDay = Number(m.partial?.split(/[–-]/)[1]);
    if (range && lastDay > 0) {
      const year = new Date(range.from).getUTCFullYear();
      const holidays = philippineHolidays([year]).map((h) => h.date);
      const done = workingDays(range.from, range.from + (lastDay - 1) * DAY, holidays);
      const all = workingDays(range.from, range.to, holidays);
      const so = blocks[partial].total.total;
      if (done > 0) {
        numbers.push(`${title(m.label)} is partial (days ${m.partial}): ${n(so)} patients in ${done} of ${all} working days. At this pace it would end near ${n((so / done) * all)}.`);
        keyNumbers.push({ label: `${title(m.label)} so far`, value: n(so), note: `On pace for about ${n((so / done) * all)} (${done} of ${all} working days)` });
      }
    }
  }
  sections.push({ heading: 'Patient numbers', lines: numbers });

  /* ---------- Workload ---------- */
  const workload: string[] = [];
  if (overall.top.count && total) keyNumbers.push({ label: 'Top RSW overall', value: n(overall.top.count), note: overall.top.name });
  if (overall.top.count && total) workload.push(`${overall.top.name} catered the most patients overall: ${n(overall.top.count)} (${pct(overall.top.count / total)} of all).`);
  const tops = new Map<string, number>();
  for (const x of full) if (x.b.top.count) tops.set(x.b.top.name, (tops.get(x.b.top.name) ?? 0) + 1);
  const leader = [...tops].sort((a, b) => b[1] - a[1])[0];
  if (leader && leader[1] > 1) workload.push(`${leader[0]} was the top RSW in ${leader[1]} of ${full.length} complete months.`);
  const last = full[full.length - 1];
  if (last) {
    const counts = last.b.lines.map((l) => l.total).filter((v) => v > 0).sort((a, b) => b - a);
    if (counts.length >= 3) {
      const cv = stdev(counts) / mean(counts);
      const top3 = (counts[0] + counts[1] + counts[2]) / counts.reduce((s, v) => s + v, 0);
      workload.push(`In ${title(last.m.label)}, the top 3 of ${counts.length} active RSWs handled ${pct(top3)} of patients; the workload is ${cv > 0.6 ? 'very uneven' : cv > 0.35 ? 'uneven' : 'fairly balanced'} (coefficient of variation ${cv.toFixed(2)}).`);
      if (cv > 0.6) actions.push(`Rebalance case assignments: workload in ${title(last.m.label)} ranged from ${n(counts[counts.length - 1])} to ${n(counts[0])} patients per RSW.`);
    }
  }
  sections.push({ heading: 'Workload', lines: workload });

  /* ---------- RSWs who need attention, and who improved ---------- */
  const people: string[] = [];
  if (full.length >= 3) {
    const lastI = full.length - 1;
    const rows = report.workers.map((w, k) => {
      const history = full.slice(0, lastI).map((x) => x.b.lines[k].total);
      const before = history.filter((v) => v > 0);
      return { w, now: full[lastI].b.lines[k].total, avg: before.length ? mean(before) : 0, months: before.length };
    });
    const drops = rows.filter((r) => r.avg >= 30 && r.months >= 2 && r.now < r.avg * 0.6).sort((a, b) => a.now / a.avg - b.now / b.avg);
    for (const r of drops.slice(0, 4)) people.push(r.now === 0
      ? `${r.w} recorded no patients in ${title(last.m.label)}, after an average of ${n(r.avg)} per month. Check for leave, transfer, or forms filed under another name.`
      : `${r.w} catered ${n(r.now)} patients in ${title(last.m.label)}, ${pct(1 - r.now / r.avg)} below their usual ${n(r.avg)}.`);
    if (drops.length) actions.push(`Talk with ${drops.slice(0, 3).map((r) => r.w).join('; ')} about the drop in patients catered.`);
    const rise = rows.filter((r) => r.avg >= 30 && r.now > r.avg * 1.3).sort((a, b) => b.now / b.avg - a.now / a.avg)[0];
    if (rise) people.push(`${rise.w} improved the most: ${n(rise.now)} patients in ${title(last.m.label)} against a usual ${n(rise.avg)} (+${pct(rise.now / rise.avg - 1)}).`);
  }
  const errorRates = overall.lines.filter((l) => l.total >= 100).map((l) => ({ w: l.name, rate: l.errorTotal / l.total })).sort((a, b) => b.rate - a.rate);
  const avgRate = overall.total.total ? overall.total.errorTotal / overall.total.total : 0;
  if (errorRates[0] && errorRates[0].rate > Math.max(0.02, avgRate * 2)) {
    people.push(`${errorRates[0].w} has the most place-name errors: ${(errorRates[0].rate * 100).toFixed(1)} per 100 patients, against ${(avgRate * 100).toFixed(1)} on average.`);
    actions.push(`Offer a short refresher on encoding barangay, municipality, province, and region to ${end(errorRates[0].w)}.`);
  }
  if (!people.length) people.push('No RSW had an unusual drop in patients or a high error rate.');
  sections.push({ heading: 'RSWs to watch', lines: people });

  /* ---------- Patient mix ---------- */
  const mix: string[] = [];
  if (full.length >= 2) {
    const [a, b] = [full[0], full[full.length - 1]];
    const shift = (name: string, get: (x: typeof a) => [number, number]) => {
      const [x1, y1] = get(a);
      const [x2, y2] = get(b);
      if (x1 + y1 < 20 || x2 + y2 < 20) return;
      const t = chiSquare([[x1, y1], [x2, y2]]);
      const [s1, s2] = [x1 / (x1 + y1), x2 / (x2 + y2)];
      mix.push(t.p < 0.01 && Math.abs(s2 - s1) >= 0.05
        ? `${name} ${s2 > s1 ? 'rose' : 'fell'} from ${pct(s1)} in ${title(a.m.label)} to ${pct(s2)} in ${title(b.m.label)} (chi-square ${pText(t.p)}).`
        : `${name} held steady at about ${pct(s2)} (${pct(s1)} in ${title(a.m.label)}).`);
    };
    shift('The share of NEW patients', (x) => [x.b.total.newPatients, x.b.total.oldPatients]);
    shift('The share of OP patients', (x) => [x.b.total.types[2], x.b.total.types.reduce((s, v) => s + v, 0) - x.b.total.types[2]]);
    shift('The share of C3 patients', (x) => [x.b.total.classes[3], x.b.total.classes.reduce((s, v) => s + v, 0) - x.b.total.classes[3]]);
  }
  if (mix.length) sections.push({ heading: 'Patient mix', lines: mix });

  /* ---------- Data quality ---------- */
  const quality = checks.filter((c) => c.level === 'warn' || c.level === 'bad').map((c) => c.title);
  if (p.audit.length || overall.total.errorTotal) quality.push(`${n(overall.total.errorTotal)} place-name errors were flagged (${(avgRate * 100).toFixed(1)} per 100 patients).`);
  sections.push({ heading: 'Data quality', lines: quality.length ? quality : ['Every check passed.'] });
  if (checks.some((c) => c.level === 'bad')) actions.unshift('Fix the totals that do not add up (see DATA CHECKS) before sharing the report.');

  sections.push({ heading: 'Recommended actions', lines: (actions.length ? actions : ['No action needed: patient numbers, workload, and data quality are all in order.']).map((a, i) => `${i + 1}. ${a}`) });
  const lastFull = full[full.length - 1];
  const headline = [
    `${n(total)} patients catered by ${active.length} RSWs`,
    lastFull && full.length >= 2 ? `${title(lastFull.m.label)} ${lastFull.b.total.total >= full[full.length - 2].b.total.total ? 'up' : 'down'} on ${title(full[full.length - 2].m.label)}` : null,
    expected !== null ? `about ${n(expected)} expected next month` : null,
  ].filter(Boolean).join('; ');
  const shareOf = (a: number, b: number) => (a + b ? a / (a + b) : 0);
  return {
    headline: `${headline}.`, sections, keyNumbers, forecast: fc,
    monthly: months.map((m, i) => ({ label: title(m.label), value: blocks[i].total.total, partial: i === partial })),
    workload: last ? { month: title(last.m.label), rows: last.b.lines.filter((l) => l.total > 0).map((l) => ({ label: l.name, value: l.total })).sort((a, b) => b.value - a.value) } : undefined,
    mix: months.length ? {
      months: months.map((m) => title(m.label).replace(/ \d{4}$/, '')),
      newShare: blocks.map((b) => shareOf(b.total.newPatients, b.total.oldPatients)),
      oldShare: blocks.map((b) => shareOf(b.total.oldPatients, b.total.newPatients)),
    } : undefined,
  };
}
