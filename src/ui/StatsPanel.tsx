// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { abTest, describeNumbers, detectAnomalies, linearRegression, measureKind, periodGrowth, regressionData, segmentTable } from '../core/analytics';
import { formatNumber, formatPct } from '../core/format';
import { periodFor } from '../core/insights';
import { keyLabel } from '../core/report';
import type { Cell, Constraint, DatePart, ValueRef } from '../core/types';
import { useStore } from '../state/store';

const SECTIONS = [['summary', 'Summary statistics'], ['growth', 'Growth over time'], ['segments', 'Segments'], ['anomalies', 'Unusual changes'], ['compare', 'Compare groups'], ['ab', 'A/B test'], ['regression', 'Regression']] as const;
type Section = (typeof SECTIONS)[number][0];

const fmtP = (p: number) => (p < 0.001 ? '< 0.001' : p.toFixed(3));
const n2 = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <div className="vt small stats-table"><table><thead><tr>{headers.map((h, i) => <th key={h} className={i ? 'num' : ''}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'num' : 'wrap'}>{c}</td>)}</tr>)}</tbody></table></div>;
}

function Verdict({ good, children }: { good: boolean; children: ReactNode }) {
  return <p className={`verdict ${good ? 'yes' : ''}`} role="status">{good ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} <span>{children}</span></p>;
}

export function StatsPanel({ cs, compare }: { cs: Constraint[]; compare: ReactNode }) {
  const en = useStore((s) => s.engine)!;
  const columns = en.table.columns;
  const numeric = columns.filter((c) => c.type === 'number' && c.role !== 'id' && new Set(c.values.filter((v) => v !== null)).size > 1);
  const groups = columns.filter((c) => (c.type === 'category' || c.type === 'boolean') && c.role === 'dimension');
  const date = en.firstDateColumn;
  const [section, setSection] = useState<Section>('summary');
  const [metric, setMetric] = useState('');
  const [group, setGroup] = useState(groups[0]?.name ?? '');
  const [part, setPart] = useState<DatePart>(() => { const p = date ? periodFor(en, date, []) : 'month'; return p === 'year' ? 'quarter' : p; });
  const [outcome, setOutcome] = useState(groups[1]?.name ?? groups[0]?.name ?? '');
  const [success, setSuccess] = useState('');
  const [armA, setArmA] = useState('');
  const [armB, setArmB] = useState('');
  const [target, setTarget] = useState(numeric[0]?.name ?? '');
  const [inputs, setInputs] = useState<string[]>(numeric[1] ? [numeric[1].name] : []);

  const valueOf = (m: string): ValueRef => {
    const c = en.column(m);
    return c ? { kind: 'col', col: m, agg: c.role === 'ratio' ? 'avg' : 'sum' } : { kind: 'col', col: columns[0]?.name ?? '', agg: 'rows' };
  };
  const value = valueOf(metric);
  const f = (x: number | null) => formatNumber(x, en.valueFormat(value));
  const metricPick = (allowRecords = true) => (
    <label className="field compact">Metric <select value={metric} onChange={(e) => setMetric(e.target.value)}>
      {allowRecords && <option value="">Number of records</option>}{numeric.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select></label>
  );
  const groupPick = (label: string, v: string, set: (x: string) => void) => <label className="field compact">{label} <select value={v} onChange={(e) => set(e.target.value)}>{groups.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>;
  const options = (col: string) => { const field = { col }; return [...en.groupRows(cs, field).keys()].filter((k) => k !== null).map((k) => ({ key: k as Cell, label: keyLabel(en, field, k) })).sort((a, b) => a.label.localeCompare(b.label)); };

  const growth = useMemo(() => (date ? periodGrowth(en, value, date, part, cs) : []), [en, metric, date, part, cs]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => {
    switch (section) {
      case 'summary': {
        const rows = en.rows(cs);
        return <>
          <p className="hint">{rows.length.toLocaleString()} records in the current filters.</p>
          {numeric.length === 0 && <p className="hint">This data has no numeric measures.</p>}
          {numeric.map((c) => {
            const d = describeNumbers(en.numbers(c.name, rows), rows.length);
            if (!d) return null;
            return <section key={c.name} className="stat-card"><b>{c.name}</b><small>{measureKind(c)}</small>
              <dl>{([['Values', d.n.toLocaleString()], ['Blank', d.missing.toLocaleString()], ...(c.role === 'measure' ? [['Total', n2(d.total)]] : []), ['Average', n2(d.mean)], ['Median', n2(d.median)], ['Std deviation', n2(d.stdev)], ['Lowest', n2(d.min)], ['Highest', n2(d.max)], ['Q1', n2(d.q1)], ['Q3', n2(d.q3)], ['95% range of average', d.ciLow === null ? '–' : `${n2(d.ciLow)} to ${n2(d.ciHigh)}`]] as string[][]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </section>;
          })}
        </>;
      }
      case 'growth':
        if (!date) return <p className="hint">Growth needs a date column.</p>;
        return <>
          {metricPick()}
          <label className="field compact">Period <select value={part} onChange={(e) => setPart(e.target.value as DatePart)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select></label>
          <Table headers={['Period', 'Value', 'Change', 'Growth']} rows={growth.slice(-60).map((p) => [`${p.label}${p.partial ? ' (unfinished)' : ''}`, f(p.value), p.change === null ? '–' : f(p.change), p.partial ? '–' : p.growth === null ? '–' : formatPct(p.growth)])} />
        </>;
      case 'segments': {
        const field = { col: group };
        const rows = group ? segmentTable(en, field, metric || null, cs, (k) => keyLabel(en, field, k)) : [];
        return <>
          {groupPick('Group by', group, setGroup)}{metricPick()}
          <Table headers={[group, 'Records', 'Share', ...(metric ? ['Total', 'Average', 'Median'] : [])]} rows={rows.slice(0, 100).map((r) => [r.label, r.records.toLocaleString(), formatPct(r.share), ...(metric ? [n2(r.total), n2(r.average), n2(r.median)] : [])])} />
        </>;
      }
      case 'anomalies': {
        if (!date) return <p className="hint">Unusual changes need a date column.</p>;
        const found = detectAnomalies(growth.filter((p) => !p.partial));
        return <>
          {metricPick()}
          <label className="field compact">Period <select value={part} onChange={(e) => setPart(e.target.value as DatePart)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option></select></label>
          {growth.length < 8 ? <p className="hint">At least 8 periods are needed.</p> : found.length ? <>
            <Verdict good={false}>{found.length} unusual {found.length === 1 ? 'period was' : 'periods were'} found.</Verdict>
            <Table headers={['Period', 'Type', 'Actual', 'Expected', 'Score']} rows={found.map((a) => [a.label, a.direction === 'spike' ? 'Spike' : 'Drop', f(a.value), f(a.expected), a.score.toFixed(1)])} />
          </> : <Verdict good>No unusual spikes or drops were found.</Verdict>}
          <p className="hint">Each period is compared with the periods around it. Scores beyond 3.5 are flagged.</p>
        </>;
      }
      case 'compare': return compare;
      case 'ab': {
        const arms = group ? options(group) : [];
        const outs = outcome ? options(outcome) : [];
        const a = armA || String(arms[0]?.key ?? '');
        const b = armB || String(arms[1]?.key ?? '');
        const hit = success || String(outs[0]?.key ?? '');
        const keyOf = (list: typeof arms, s: string) => list.find((x) => String(x.key) === s)?.key;
        const count = (arm: string) => {
          const base = [...cs, { col: group, kind: 'in' as const, values: [keyOf(arms, arm) ?? null] }];
          return [en.rows([...base, { col: outcome, kind: 'in' as const, values: [keyOf(outs, hit) ?? null] }]).length, en.rows(base).filter((r) => en.column(outcome)!.values[r] !== null).length];
        };
        const [ca, na] = group && outcome ? count(a) : [0, 0];
        const [cb, nb] = group && outcome ? count(b) : [0, 0];
        const r = a !== b && group !== outcome ? abTest(ca, na, cb, nb) : null;
        const pick = (label: string, v: string, set: (x: string) => void, list: typeof arms) => <label className="field compact">{label} <select value={v} onChange={(e) => set(e.target.value)}>{list.slice(0, 200).map((o) => <option key={String(o.key)} value={String(o.key)}>{o.label}</option>)}</select></label>;
        if (groups.length < 2) return <p className="hint">An A/B test needs two category columns.</p>;
        return <>
          <p className="hint">Check whether one group reaches an outcome more often than another.</p>
          {groupPick('Groups come from', group, (x) => { setGroup(x); setArmA(''); setArmB(''); })}
          <div className="two">{pick('Group A', a, setArmA, arms)}{pick('Group B', b, setArmB, arms)}</div>
          {groupPick('Outcome column', outcome, (x) => { setOutcome(x); setSuccess(''); })}
          {pick('Counts as success', hit, setSuccess, outs)}
          {r ? <>
            <Table headers={['Group', 'Success', 'Total', 'Rate']} rows={[[keyLabel(en, { col: group }, keyOf(arms, a) ?? null), ca.toLocaleString(), na.toLocaleString(), formatPct(r.rateA)], [keyLabel(en, { col: group }, keyOf(arms, b) ?? null), cb.toLocaleString(), nb.toLocaleString(), formatPct(r.rateB)]]} />
            <dl className="mini-stats"><div><dt>Difference</dt><dd>{(r.difference * 100).toFixed(1)} points</dd></div><div><dt>95% range</dt><dd>{(r.low * 100).toFixed(1)} to {(r.high * 100).toFixed(1)}</dd></div><div><dt>z</dt><dd>{r.z.toFixed(2)}</dd></div><div><dt>p-value</dt><dd>{fmtP(r.p)}</dd></div></dl>
            <Verdict good={r.significant}>{r.significant ? 'The difference is statistically significant.' : 'The difference could be due to chance.'}</Verdict>
          </> : <p className="hint">Choose two different groups and a different outcome column.</p>}
        </>;
      }
      case 'regression': {
        if (numeric.length < 2) return <p className="hint">Regression needs at least two numeric columns.</p>;
        const chosen = inputs.filter((x) => x !== target);
        const data = regressionData(en, target, chosen, cs);
        const r = chosen.length ? linearRegression(data.y, data.xs, chosen) : null;
        return <>
          <p className="hint">Estimate how other numbers relate to the one you want to explain.</p>
          <label className="field compact">Explain this number <select value={target} onChange={(e) => setTarget(e.target.value)}>{numeric.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
          <fieldset className="check-list"><legend>Using these numbers</legend>{numeric.filter((c) => c.name !== target).map((c) => <label key={c.name}><input type="checkbox" checked={chosen.includes(c.name)} onChange={(e) => setInputs((x) => (e.target.checked ? [...x, c.name] : x.filter((y) => y !== c.name)))} /> {c.name}</label>)}</fieldset>
          {r ? <>
            <Table headers={['Term', 'Coefficient', 'Std error', 't', 'p-value']} rows={r.terms.map((t) => [t.name, n2(t.coefficient), n2(t.stdError), t.t.toFixed(2), fmtP(t.p)])} />
            <dl className="mini-stats"><div><dt>R²</dt><dd>{r.r2.toFixed(3)}</dd></div><div><dt>Adjusted R²</dt><dd>{r.adjustedR2.toFixed(3)}</dd></div><div><dt>F</dt><dd>{n2(r.f)}</dd></div><div><dt>Rows</dt><dd>{r.n.toLocaleString()}</dd></div></dl>
            <Verdict good={r.fP < 0.05}>{r.fP < 0.05 ? `These inputs explain ${formatPct(r.r2)} of the variation in ${target}.` : 'These inputs do not reliably explain this number.'} Relationships do not prove cause.</Verdict>
          </> : <p className="hint">Choose at least one input with enough complete rows and different values.</p>}
        </>;
      }
    }
  };

  return <>
    <label className="field compact">Analysis <select aria-label="Analysis type" value={section} onChange={(e) => setSection(e.target.value as Section)}>{SECTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {body()}
  </>;
}
