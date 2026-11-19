// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useState } from 'react';
import { AlertTriangle, BrainCircuit, CheckCircle2, ChevronDown, ChevronUp, Copy, Info, ListChecks, TrendingDown, TrendingUp, Minus, X } from 'lucide-react';
import { analyzeReport, briefText } from '../core/analyst';
import type { Constraint } from '../core/types';
import { useStore } from '../state/store';
import { forecastOption } from './analystChart';
import { EChart } from './EChart';

/** The AI analyst brief: written summary, trend, forecast, drivers, risks, and recommended actions. */
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
  const option = useMemo(() => (b.forecast ? forecastOption(b, dark) : null), [b, dark]);
  const TrendIcon = b.trend?.direction === 'up' ? TrendingUp : b.trend?.direction === 'down' ? TrendingDown : Minus;
  const copy = async () => {
    try { await navigator.clipboard.writeText(briefText(b)); toast('success', 'The AI brief was copied.'); } catch { toast('error', 'The brief could not be copied.'); }
  };

  return (
    <section className={`analyst ${open ? 'open' : ''}`} aria-label="AI analyst brief">
      <header>
        <span className="analyst-badge"><BrainCircuit size={16} /> AI analyst</span>
        <h2>{b.headline}</h2>
        <span className={`analyst-confidence ${b.confidence.level}`} title={b.confidence.reason}>{b.confidence.level} confidence</span>
        <button className="icon-btn sm" aria-label="Copy the brief" title="Copy the brief" onClick={() => void copy()}><Copy size={14} /></button>
        <button className="icon-btn sm" aria-label={open ? 'Collapse the brief' : 'Expand the brief'} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
        <button className="icon-btn sm" aria-label="Close the AI analyst" onClick={onClose}><X size={14} /></button>
      </header>
      {open && (
        <div className="analyst-body">
          <div className="analyst-summary">
            <h3>Summary</h3>
            {b.summary.map((s, i) => <p key={i} style={{ animationDelay: `${i * 90}ms` }}>{s}</p>)}
            {b.trend && <p className={`analyst-trend ${b.trend.direction}`}><TrendIcon size={15} /> {b.trend.direction === 'flat' ? 'No significant trend' : `Significant ${b.trend.direction}ward trend`}</p>}
          </div>
          {option && (
            <div className="analyst-forecast">
              <h3>Forecast</h3>
              <div className="analyst-chart"><EChart option={option} label={b.forecast!.text} patterns={false} /></div>
              <small>{b.forecast!.method}{b.forecast!.mape !== null ? ` · backtest error ${(b.forecast!.mape * 100).toFixed(0)}%` : ''}</small>
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
          <div className="analyst-list">
            <h3>Risks and unusual results</h3>
            {b.risks.length ? <ul>{b.risks.map((r, i) => (
              <li key={i} className={`risk ${r.level}`}>{r.level === 'low' ? <Info size={14} /> : <AlertTriangle size={14} />}<span>{r.text}</span></li>
            ))}</ul> : <p className="analyst-ok"><CheckCircle2 size={14} /> No anomalies or open data issues were found.</p>}
          </div>
          <div className="analyst-list">
            <h3><ListChecks size={14} /> Recommended actions</h3>
            <ol>{b.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
            <small className="analyst-note">Worked out on this device from the report's own numbers. {b.confidence.reason}</small>
          </div>
        </div>
      )}
    </section>
  );
}
