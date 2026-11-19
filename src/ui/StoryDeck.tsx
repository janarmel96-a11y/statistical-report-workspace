// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo } from 'react';
import { AlertTriangle, BrainCircuit, CheckCircle2, Info, Sparkles, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { analyzeReport, type AnalystBrief } from '../core/analyst';
import { buildStory, type StoryKpi } from '../core/story';
import type { Constraint } from '../core/types';
import { useStore } from '../state/store';
import { forecastOption } from './analystChart';
import { CountUp } from './CountUp';
import { EChart } from './EChart';

/**
 * The AI story slides of Present mode: they open the presentation before the report pages and close it after them.
 * Every slide animates in, numbers count up, and the forecast chart draws itself.
 */

export type DeckSlide =
  | { kind: 'title'; title: string; subtitle: string; organization?: string }
  | { kind: 'summary'; brief: AnalystBrief }
  | { kind: 'kpis'; kpis: StoryKpi[] }
  | { kind: 'forecast'; brief: AnalystBrief }
  | { kind: 'insights'; brief: AnalystBrief }
  | { kind: 'actions'; brief: AnalystBrief; title: string };

export function useStoryDeck(cs: Constraint[], active: boolean): { intro: DeckSlide[]; outro: DeckSlide[] } {
  const en = useStore((s) => s.engine);
  const report = useStore((s) => s.report);
  const findings = useStore((s) => s.findings);
  const disabled = useStore((s) => s.disabled);
  return useMemo(() => {
    if (!active || !en || !report) return { intro: [], outro: [] };
    const used = findings.filter((f) => !disabled.includes(f.id));
    const brief = analyzeReport(en, used, cs);
    const scenes = buildStory(en, report, used, cs, { detail: 'detailed', filterText: '' });
    const kpis = scenes.find((s) => s.kind === 'kpis')?.kpis ?? [];
    const intro: DeckSlide[] = [
      { kind: 'title', title: report.title, subtitle: brief.summary[0] ?? '', organization: report.design?.organization },
      { kind: 'summary', brief },
      ...(kpis.length ? [{ kind: 'kpis' as const, kpis: kpis.slice(0, 4) }] : []),
      ...(brief.forecast ? [{ kind: 'forecast' as const, brief }] : []),
      ...(brief.drivers.length || brief.risks.length ? [{ kind: 'insights' as const, brief }] : []),
    ];
    return { intro, outro: [{ kind: 'actions', brief, title: report.title }] };
  }, [active, en, report, findings, disabled, cs]);
}

const stagger = (i: number, base = 250) => ({ animationDelay: `${base + i * 160}ms` });

export function StorySlideView({ slide, index }: { slide: DeckSlide; index: number }) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const motion = ['zoom', 'rise', 'slide'][index % 3];
  if (slide.kind === 'title') {
    return (
      <section className={`story-slide title ${motion}`} aria-label="Title slide">
        <div className="story-glow" aria-hidden="true" />
        {slide.organization && <small className="story-kicker" style={stagger(0, 100)}>{slide.organization}</small>}
        <span className="story-chip" style={stagger(0, 150)}><Sparkles size={15} /> AI-generated presentation</span>
        <h1 style={stagger(1)}>{slide.title}</h1>
        <p style={stagger(2)}>{slide.subtitle}</p>
      </section>
    );
  }
  if (slide.kind === 'summary') {
    const b = slide.brief;
    const Icon = b.trend?.direction === 'up' ? TrendingUp : b.trend?.direction === 'down' ? TrendingDown : Minus;
    return (
      <section className={`story-slide ${motion}`} aria-label="AI summary">
        <small className="story-kicker"><BrainCircuit size={15} /> AI analyst</small>
        <h2 style={stagger(0, 80)}>{b.headline}</h2>
        <ul className="story-points">{b.summary.slice(1, 5).map((s, i) => <li key={i} style={stagger(i)}>{s}</li>)}</ul>
        {b.trend && <p className={`story-trend ${b.trend.direction}`} style={stagger(5)}><Icon size={18} /> {b.trend.direction === 'flat' ? 'No significant trend' : `Significant ${b.trend.direction}ward trend`}</p>}
      </section>
    );
  }
  if (slide.kind === 'kpis') {
    return (
      <section className={`story-slide ${motion}`} aria-label="Key figures">
        <small className="story-kicker">Key figures</small>
        <div className="story-kpis">{slide.kpis.map((k, i) => (
          <div key={k.label} className="story-kpi" style={stagger(i, 120)}>
            <span>{k.label}</span>
            <b><CountUp text={k.value} /></b>
            {k.note && <small className={k.note.startsWith('Down') ? 'down' : 'up'}>{k.note}</small>}
          </div>
        ))}</div>
      </section>
    );
  }
  if (slide.kind === 'forecast') {
    const f = slide.brief.forecast!;
    return (
      <section className={`story-slide ${motion}`} aria-label="AI forecast">
        <small className="story-kicker"><BrainCircuit size={15} /> AI forecast</small>
        <h2 style={stagger(0, 80)}>{f.text.split('. ')[0]}.</h2>
        <div className="story-chart" style={stagger(1)}><EChart option={forecastOption(slide.brief, dark, true)} label={f.text} patterns={false} /></div>
        <p className="story-note" style={stagger(3)}>{f.method}{f.mape !== null ? ` · backtest error about ${(f.mape * 100).toFixed(0)}%` : ''} · shaded band shows the 95% range</p>
      </section>
    );
  }
  if (slide.kind === 'insights') {
    const b = slide.brief;
    return (
      <section className={`story-slide ${motion}`} aria-label="What drives the numbers">
        <small className="story-kicker">What the AI found</small>
        <div className="story-columns">
          <div>
            <h3>What drives the numbers</h3>
            <ul className="story-points small">{b.drivers.slice(0, 3).map((d, i) => (
              <li key={d.dim} style={stagger(i)}><span className={`story-meter ${d.level}`}><i style={{ width: `${Math.max(8, Math.min(100, d.strength * 100))}%` }} /></span>{d.text}</li>
            ))}</ul>
          </div>
          <div>
            <h3>Risks and unusual results</h3>
            {b.risks.length ? <ul className="story-points small">{b.risks.slice(0, 4).map((r, i) => (
              <li key={i} className={`risk ${r.level}`} style={stagger(i + 3)}>{r.level === 'low' ? <Info size={16} /> : <AlertTriangle size={16} />}{r.text}</li>
            ))}</ul> : <p className="story-ok" style={stagger(3)}><CheckCircle2 size={18} /> No anomalies or open data issues.</p>}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className={`story-slide closing ${motion}`} aria-label="Recommended actions">
      <div className="story-glow" aria-hidden="true" />
      <small className="story-kicker"><Sparkles size={15} /> AI recommendations</small>
      <h2 style={stagger(0, 80)}>What to do next</h2>
      <ol className="story-points">{slide.brief.actions.map((a, i) => <li key={i} style={stagger(i)}>{a}</li>)}</ol>
      <p className="story-note" style={stagger(slide.brief.actions.length + 1)}>Confidence: {slide.brief.confidence.level}. {slide.brief.confidence.reason}</p>
    </section>
  );
}
