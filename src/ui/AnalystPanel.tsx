// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BrainCircuit, CalendarRange, CheckCircle2, ChevronDown, ChevronUp, Copy, FlaskConical, Info, Link2,
  ListChecks, Minus, Sigma, TrendingDown, TrendingUp, X,
} from 'lucide-react';
import { analyzeReport, briefText, type AnalystBrief } from '../core/analyst';
import { formatNumber } from '../core/format';
import type { Constraint } from '../core/types';
import { useStore } from '../state/store';
import { forecastOption, rankedBarsOption } from './analystChart';
import { CountUp } from './CountUp';
import { EChart } from './EChart';

const pct = (v: number) => `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;

/** Key figures as tiles whose numbers count up. */
export function KeyTiles({ items }: { items: AnalystBrief['keyNumbers'] }) {
  return (
    <div className="analyst-tiles">
      {items.map((k, i) => (
        <div key={k.label} className={`analyst-tile ${k.tone ?? ''}`} style={{ animationDelay: `${i * 80}ms` }}>
          <span>{k.label}</span>
          <b><CountUp text={k.value} /></b>
          {k.note && <small>{k.tone === 'up' ? <ArrowUpRight size={13} /> : k.tone === 'down' ? <ArrowDownRight size={13} /> : null}{k.note}</small>}
        </div>
      ))}
    </div>
  );
}

/** The analyst brief: key numbers, summary, forecast, segments, drivers, relationships, distribution, risks, and actions. */
export function AnalystPanel({ cs, onClose }: { cs: Constraint[]; onClose: () => void }) {
  const en = useStore((s) => s.engine)!;
  const findings = useStore((s) => s.findings);
  const disabled = useStore((s) => s.disabled);
  const rev = useStore((s) => s.revision);
  const toast = useStore((s) => s.toast);
  const dark = document.documentElement.dataset.theme === 'dark';
  const [open, setOpen] = useState(true);
  const active = useMemo(() => findings.filter((f) => !disabled.includes(f.id)), [findings, disabled]);
  const b = useMemo(() => analyzeReport(en, active, cs), [en, active, cs, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const forecast = useMemo(() => (b.forecast ? forecastOption(b, dark) : null), [b, dark]);
  const segChart = useMemo(() => (b.segments ? rankedBarsOption(b.segments.rows.map((r) => ({
    label: r.label, value: r.value, note: `${formatNumber(r.value, { ...b.format, compact: true })}${r.share !== null ? ` · ${pct(r.share)}` : ''}`,
  })), dark) : null), [b, dark]);
  const TrendIcon = b.trend?.direction === 'up' ? TrendingUp : b.trend?.direction === 'down' ? TrendingDown : Minus;
  const copy = async () => {
    try { await navigator.clipboard.writeText(briefText(b)); toast('success', 'The analysis was copied.'); } catch { toast('error', 'The analysis could not be copied.'); }
  };

  return (
    <section className={`analyst ${open ? 'open' : ''}`} aria-label="Analyst" data-guide="analyst-panel">
      <header>
        <span className="analyst-badge"><BrainCircuit size={16} /> Analyst</span>
        <h2>{b.headline}</h2>
        <span className={`analyst-confidence ${b.confidence.level}`} title={b.confidence.reason}>{b.confidence.level} confidence</span>
        <button className="icon-btn sm" aria-label="Copy the analysis" title="Copy the analysis" onClick={() => void copy()}><Copy size={14} /></button>
        <button className="icon-btn sm" aria-label={open ? 'Collapse the analysis' : 'Expand the analysis'} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
        <button className="icon-btn sm" aria-label="Close the analyst" onClick={onClose}><X size={14} /></button>
      </header>
      {open && <>
        {b.keyNumbers.length > 0 && <KeyTiles items={b.keyNumbers} />}
        <div className="analyst-body">
          <div className="analyst-summary">
            <h3>Executive summary</h3>
            {b.summary.map((s, i) => <p key={i} style={{ animationDelay: `${150 + i * 90}ms` }}>{s}</p>)}
            {b.trend && <p className={`analyst-trend ${b.trend.direction}`}><TrendIcon size={15} /> {b.trend.direction === 'flat' ? 'No significant trend' : `Significant ${b.trend.direction}ward trend`}</p>}
          </div>
          {forecast && (
            <div className="analyst-forecast">
              <h3><TrendingUp size={14} /> Forecast</h3>
              <div className="analyst-chart"><EChart option={forecast} label={b.forecast!.text} patterns={false} /></div>
              <small>{b.forecast!.method}{b.forecast!.mape !== null ? ` · backtest error ${(b.forecast!.mape * 100).toFixed(0)}%` : ''} · band shows the 95% range</small>
            </div>
          )}
          {b.segments && segChart && (
            <div className="analyst-segments">
              <h3><Sigma size={14} /> Performance by {b.segments.dim}</h3>
              <div className="analyst-chart" style={{ height: Math.max(150, b.segments.rows.length * 30 + 20) }}><EChart option={segChart} label={b.segments.text.join(' ')} patterns={false} /></div>
              {b.segments.text.map((t, i) => <p key={i}>{t}</p>)}
              {b.segments.growthLabel && (
                <ul className="analyst-growth">{b.segments.rows.filter((r) => r.growth !== null).slice(0, 6).map((r) => (
                  <li key={r.label} className={r.growth! > 0.005 ? 'up' : r.growth! < -0.005 ? 'down' : ''}>
                    <span>{r.label}</span><b>{r.growth! >= 0 ? '+' : '−'}{pct(Math.abs(r.growth!))}</b>
                  </li>
                ))}<li className="analyst-growth-note">{b.segments.growthLabel}</li></ul>
              )}
            </div>
          )}
          {b.drivers.length > 0 && (
            <div className="analyst-list">
              <h3>What drives the numbers</h3>
              <ul>{b.drivers.map((d) => (
                <li key={d.dim} title={d.test}>
                  <span className={`analyst-meter ${d.level}`}><i style={{ width: `${Math.max(6, Math.min(100, d.strength * 100))}%` }} /></span>
                  <span>{d.text}<small>{d.test}</small></span>
                </li>
              ))}</ul>
            </div>
          )}
          {(b.relationships.length > 0 || b.distribution.length > 0 || b.seasonality) && (
            <div className="analyst-list">
              {b.seasonality && <><h3><CalendarRange size={14} /> Seasonal pattern</h3><p className="analyst-text">{b.seasonality}</p></>}
              {b.relationships.length > 0 && <>
                <h3><Link2 size={14} /> Relationships</h3>
                <ul>{b.relationships.map((r, i) => <li key={i}><span>{r.text}<small>{r.test}</small></span></li>)}</ul>
              </>}
              {b.distribution.length > 0 && <>
                <h3><Sigma size={14} /> Distribution and outliers</h3>
                <ul>{b.distribution.map((d, i) => <li key={i}><span>{d}</span></li>)}</ul>
              </>}
            </div>
          )}
          <div className="analyst-list">
            <h3>Risks and unusual results</h3>
            {b.risks.length ? <ul>{b.risks.map((r, i) => (
              <li key={i} className={`risk ${r.level}`}>{r.level === 'low' ? <Info size={14} /> : <AlertTriangle size={14} />}<span>{r.text}</span></li>
            ))}</ul> : <p className="analyst-ok"><CheckCircle2 size={14} /> No anomalies or open data issues were found.</p>}
          </div>
          <div className="analyst-list">
            <h3><ListChecks size={14} /> Recommended actions</h3>
            <ol>{b.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
            {b.methods.length > 0 && (
              <details className="analyst-methods">
                <summary><FlaskConical size={13} /> How this was worked out</summary>
                <ul>{b.methods.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </details>
            )}
            <small className="analyst-note">Worked out on this device from the report's own numbers. {b.confidence.reason}</small>
          </div>
        </div>
      </>}
    </section>
  );
}
