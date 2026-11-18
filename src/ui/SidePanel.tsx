// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import {
  AlertTriangle, AreaChart, BarChart2, BarChart3, BoxSelect, Calendar, CheckCircle2, Columns3, Dot, GripVertical, Hash, Layers, LineChart,
  ListTree, PieChart, Plus, ScatterChart, Sigma, SquareStack, Table2, TrendingUp, Type, X, Grid3x3, Lightbulb,
} from 'lucide-react';
import { measureKind } from '../core/analytics';
import { AGG_OPTIONS, aggWarning, defaultAgg } from '../core/engine';
import { formatNumber, formatPct } from '../core/format';
import { FUNCTIONS, validateMeasure } from '../core/measures';
import type { Visual, VisualType } from '../core/report';
import { anova, chiSquare, kruskalWallis, mannWhitney, meanCI, welchT, type TestResult } from '../core/stats';
import type { Agg, Cell, Column, Constraint, DatePart, FieldRef, Measure, NumberFormat, ValueRef } from '../core/types';
import { useStore } from '../state/store';
import { AssistantPanel } from './AssistantPanel';
import { DesignPanel } from './DesignPanel';
import { StatsPanel } from './StatsPanel';
import { InsightsList } from './VisualCard';

const GALLERY: [VisualType, string, ReactNode][] = [
  ['column', 'Column', <BarChart3 size={17} />], ['bar', 'Bar', <BarChart2 size={17} style={{ transform: 'rotate(90deg)' }} />], ['stacked', 'Stacked', <SquareStack size={17} />],
  ['line', 'Line', <LineChart size={17} />], ['area', 'Area', <AreaChart size={17} />], ['donut', 'Donut', <PieChart size={17} />],
  ['treemap', 'Treemap', <BoxSelect size={17} />], ['pareto', 'Pareto', <Columns3 size={17} />], ['variance', 'YoY change', <TrendingUp size={17} />],
  ['scatter', 'Scatter', <ScatterChart size={17} />], ['heatmap', 'Heatmap', <Grid3x3 size={17} />], ['histogram', 'Histogram', <BarChart3 size={17} />],
  ['box', 'Box plot', <Layers size={17} />], ['kpi', 'KPI', <Hash size={17} />], ['table', 'Table', <Table2 size={17} />], ['insights', 'Findings', <Lightbulb size={17} />],
];

type Slot = 'axis' | 'values' | 'legend' | 'tooltips' | 'multiples';
const SLOTS: { id: Slot; label: string; hint: string }[] = [
  { id: 'axis', label: 'Axis', hint: 'Categories or dates' },
  { id: 'values', label: 'Values', hint: 'Numbers to show' },
  { id: 'legend', label: 'Legend', hint: 'Split into series' },
  { id: 'tooltips', label: 'Tooltips', hint: 'Extra hover details' },
  { id: 'multiples', label: 'Small multiples', hint: 'One panel per group' },
];

const DATE_LEVELS: DatePart[] = ['year', 'quarter', 'month', 'day'];

function typeIcon(c: Column) {
  return c.type === 'date' ? <Calendar size={14} /> : c.type === 'number' ? <Hash size={14} /> : c.type === 'text' ? <Type size={14} /> : <Dot size={14} />;
}

/** Places a field into a slot of a visual, choosing safe defaults. */
export function assignField(v: Visual, slot: Slot, name: string, columns: Column[], measures: Measure[], hierarchyLevels?: string[]): Visual {
  const col = columns.find((c) => c.name === name);
  const measure = measures.find((m) => m.name === name);
  const asValue = (): ValueRef | null => (measure ? { kind: 'measure', name } : col ? { kind: 'col', col: name, agg: defaultAgg(col) } : null);
  switch (slot) {
    case 'axis': {
      if (hierarchyLevels) return { ...v, axis: hierarchyLevels.map((c) => ({ col: c })), drillLevel: 0, drillPath: [] };
      if (!col) return v;
      if (col.type === 'date') return { ...v, axis: DATE_LEVELS.map((part) => ({ col: name, part })), drillLevel: DATE_LEVELS.indexOf('month'), drillPath: [] };
      return { ...v, axis: [{ col: name }], drillLevel: 0, drillPath: [] };
    }
    case 'values': { const x = asValue(); return x ? { ...v, values: [...v.values.filter((o) => JSON.stringify(o) !== JSON.stringify(x)), x] } : v; }
    case 'tooltips': { const x = asValue(); return x ? { ...v, tooltips: [...v.tooltips, x] } : v; }
    case 'legend': return col ? { ...v, legend: { col: name, part: col.type === 'date' ? 'year' : undefined } } : v;
    case 'multiples': return col ? { ...v, multiples: { col: name, part: col.type === 'date' ? 'year' : undefined } } : v;
  }
}

function FieldRow({ name, icon, kind, onAdd }: { name: string; icon: ReactNode; kind: string; onAdd: (slot: Slot) => void }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: `${kind}:${name}`, data: { name, kind } });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  return (
    <li className={`field-row ${isDragging ? 'dragging' : ''}`} ref={setNodeRef} style={style}>
      <span className="field-grip" {...listeners} {...attributes} aria-label={`Drag ${name}`}><GripVertical size={13} /></span>
      <span className="field-icon">{icon}</span>
      <span className="field-name" title={name}>{name}</span>
      <select aria-label={`Add ${name} to a slot`} value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value as Slot); }}>
        <option value="">+</option>
        {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </li>
  );
}

function Well({ slot, children, count }: { slot: (typeof SLOTS)[number]; children: ReactNode; count: number }) {
  const { isOver, setNodeRef } = useDroppable({ id: slot.id });
  return (
    <div className={`well ${isOver ? 'over' : ''}`} ref={setNodeRef}>
      <span className="well-label">{slot.label}</span>
      {count ? children : <span className="well-hint">{slot.hint}</span>}
    </div>
  );
}

function Pill({ label, onRemove, children, warning }: { label: string; onRemove: () => void; children?: ReactNode; warning?: string | null }) {
  return (
    <div className="pill-wrap">
      <div className="pill"><span title={label}>{label}</span>{children}<button aria-label={`Remove ${label}`} onClick={onRemove}><X size={12} /></button></div>
      {warning && <p className="pill-warn"><AlertTriangle size={12} /> {warning}</p>}
    </div>
  );
}

function FieldsTab({ visual }: { visual: Visual | undefined }) {
  const engine = useStore((s) => s.engine)!;
  const report = useStore((s) => s.report)!;
  const mutate = useStore((s) => s.mutateVisual);
  const mutateReport = useStore((s) => s.mutateReport);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const columns = engine.table.columns;
  const [q, setQ] = useState('');
  const [hier, setHier] = useState<string[]>([]);
  const [hName, setHName] = useState('');

  const add = (slot: Slot, name: string, levels?: string[]) => { if (visual) mutate(visual.id, (v) => assignField(v, slot, name, columns, report.measures, levels)); };
  const onDragEnd = (e: DragEndEvent) => {
    const slot = e.over?.id as Slot | undefined;
    const d = e.active.data.current as { name: string; kind: string } | undefined;
    if (!slot || !d) return;
    add(slot, d.name, d.kind === 'h' ? report.hierarchies.find((h) => h.name === d.name)?.levels : undefined);
  };
  const shown = columns.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const dims = columns.filter((c) => c.type === 'category' || c.type === 'boolean');

  if (!visual) return <p className="side-empty">Select a chart to change its fields, or use Add visual above the report.</p>;
  const valueLabel = (x: ValueRef) => (x.kind === 'measure' ? x.name : x.agg === 'rows' ? 'Records' : x.col);
  const setAgg = (i: number, agg: Agg) => mutate(visual.id, (v) => ({ ...v, values: v.values.map((x, k) => (k === i && x.kind === 'col' ? { ...x, agg } : x)) }));

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <label className="field compact">Title <input value={visual.title} onChange={(e) => mutate(visual.id, (v) => ({ ...v, title: e.target.value }), false)} /></label>
      <div className="gallery" role="radiogroup" aria-label="Visual type">
        {GALLERY.map(([t, label, icon]) => (
          <button key={t} role="radio" aria-checked={visual.type === t} aria-label={label} title={label} className={visual.type === t ? 'on' : ''} onClick={() => mutate(visual.id, (v) => ({ ...v, type: t }))}>{icon}</button>
        ))}
      </div>
      {visual.type === 'line' && (
        <label className="switch solo"><input type="checkbox" checked={Boolean(visual.forecast)} onChange={(e) => mutate(visual.id, (v) => ({ ...v, forecast: e.target.checked }))} /><i /><span>Show forecast</span></label>
      )}
      <div className="wells">
        {SLOTS.map((s) => {
          if (s.id === 'axis') return <Well key={s.id} slot={s} count={visual.axis.length}>{visual.axis.length > 0 && <Pill label={visual.axis.length > 1 ? `${visual.axis[0].col}${visual.axis[0].part ? ' hierarchy' : ` › ${visual.axis.slice(1).map((a) => a.col).join(' › ')}`}` : visual.axis[0].col} onRemove={() => mutate(visual.id, (v) => ({ ...v, axis: [], drillLevel: 0, drillPath: [] }))} />}</Well>;
          if (s.id === 'values') return (
            <Well key={s.id} slot={s} count={visual.values.length}>
              {visual.values.map((x, i) => {
                const c = x.kind === 'col' ? engine.column(x.col) : undefined;
                return (
                  <Pill key={i} label={valueLabel(x)} warning={x.kind === 'col' ? aggWarning(c, x.agg) : null} onRemove={() => mutate(visual.id, (v) => ({ ...v, values: v.values.filter((_, k) => k !== i) }))}>
                    {x.kind === 'col' && x.agg !== 'rows' && (
                      <select aria-label={`How to combine ${x.col}`} value={x.agg} onChange={(e) => setAgg(i, e.target.value as Agg)}>
                        {AGG_OPTIONS.filter((o) => c?.type === 'number' || !o.numeric).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                  </Pill>
                );
              })}
            </Well>
          );
          if (s.id === 'tooltips') return <Well key={s.id} slot={s} count={visual.tooltips.length}>{visual.tooltips.map((x, i) => <Pill key={i} label={valueLabel(x)} onRemove={() => mutate(visual.id, (v) => ({ ...v, tooltips: v.tooltips.filter((_, k) => k !== i) }))} />)}</Well>;
          const f = s.id === 'legend' ? visual.legend : visual.multiples;
          return <Well key={s.id} slot={s} count={f ? 1 : 0}>{f && <Pill label={f.col} onRemove={() => mutate(visual.id, (v) => ({ ...v, [s.id]: undefined }))} />}</Well>;
        })}
      </div>

      <h3 className="side-h">Fields</h3>
      <input className="search" placeholder="Search fields" aria-label="Search fields" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="field-list">
        {report.measures.map((m) => <FieldRow key={m.name} kind="m" name={m.name} icon={<Sigma size={14} />} onAdd={(s) => add(s, m.name)} />)}
        {report.hierarchies.map((h) => <FieldRow key={h.name} kind="h" name={h.name} icon={<ListTree size={14} />} onAdd={() => add('axis', h.name, h.levels)} />)}
        {shown.map((c) => <FieldRow key={c.name} kind="c" name={c.name} icon={typeIcon(c)} onAdd={(s) => add(s, c.name)} />)}
      </ul>

      <h3 className="side-h">Create a hierarchy</h3>
      <p className="hint">Pick levels from top to bottom, such as Region then City. Dates get Year, Quarter, Month, and Day automatically.</p>
      <div className="hier-build">
        {hier.map((h, i) => <span key={h} className="chip">{i + 1}. {h}<button aria-label={`Remove ${h}`} onClick={() => setHier(hier.filter((x) => x !== h))}><X size={11} /></button></span>)}
        <select aria-label="Add a level" value="" onChange={(e) => { if (e.target.value) setHier([...hier, e.target.value]); }}>
          <option value="">Add a level</option>
          {dims.filter((c) => !hier.includes(c.name)).map((c) => <option key={c.name}>{c.name}</option>)}
        </select>
      </div>
      <div className="row-gap">
        <input aria-label="Hierarchy name" placeholder="Hierarchy name" value={hName} onChange={(e) => setHName(e.target.value)} />
        <button className="btn sm" disabled={hier.length < 2 || !hName.trim()} onClick={() => { mutateReport((r) => ({ ...r, hierarchies: [...r.hierarchies, { name: hName.trim(), levels: hier }] })); setHier([]); setHName(''); }}>Save</button>
      </div>
    </DndContext>
  );
}

function MeasuresTab() {
  const engine = useStore((s) => s.engine)!;
  const report = useStore((s) => s.report)!;
  const mutateReport = useStore((s) => s.mutateReport);
  const visualId = useStore((s) => s.selectedVisual);
  const mutateVisual = useStore((s) => s.mutateVisual);
  const toast = useStore((s) => s.toast);
  const columns = engine.table.columns.map((c) => c.name);
  const [name, setName] = useState('');
  const [expr, setExpr] = useState('');
  const [format, setFormat] = useState<NumberFormat>('number');
  const [editing, setEditing] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const metric = engine.table.columns.find((c) => c.role === 'measure')?.name ?? engine.table.columns.find((c) => c.type === 'number')?.name ?? 'Value';
  const date = engine.firstDateColumn ?? 'Date';
  const dim = engine.table.columns.find((c) => c.type === 'category')?.name ?? 'Category';

  const others = report.measures.filter((m) => m.name !== editing);
  const deps = Object.fromEntries(others.map((m) => [m.name, m.expr]));
  const check = validateMeasure(expr, columns, others.map((m) => m.name), name || undefined, deps);
  const preview = useMemo(() => {
    if (!check.ok) return null;
    engine.setMeasures([...others, { name: '__preview__', expr, format }]);
    const v = engine.evaluate({ kind: 'measure', name: '__preview__' }, []);
    engine.setMeasures(report.measures);
    return v;
  }, [expr, format, check.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  const token = expr.slice(0, caret).match(/(\[[^\]]*|[A-Za-z_]+)$/)?.[0] ?? '';
  const suggestions = !token ? [] : token.startsWith('[')
    ? [...columns, ...others.map((m) => m.name)].filter((c) => c.toLowerCase().includes(token.slice(1).toLowerCase())).slice(0, 7).map((c) => ({ label: c, insert: `[${c}]`, doc: '' }))
    : Object.entries(FUNCTIONS).filter(([k]) => k.startsWith(token.toUpperCase())).slice(0, 7).map(([k, f]) => ({ label: f.sig, insert: `${k}(`, doc: f.doc }));
  const accept = (ins: string) => {
    const at = caret - token.length;
    const next = expr.slice(0, at) + ins + expr.slice(caret);
    setExpr(next);
    const pos = at + ins.length;
    setCaret(pos);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(pos, pos); });
  };

  const templates: [string, string, string, NumberFormat][] = [
    ['% of total', `Share of ${metric}`, `DIVIDE(SUM([${metric}]), CALCULATE(SUM([${metric}]), ALL([${dim}])))`, 'percent'],
    ['Running total', `Running ${metric}`, `RUNNINGSUM(SUM([${metric}]), [${date}])`, 'number'],
    ['Moving average', `3-period avg ${metric}`, `MOVINGAVG(SUM([${metric}]), [${date}], 3)`, 'number'],
    ['Year over year', `${metric} YoY %`, `DIVIDE(SUM([${metric}]) - PREVIOUSYEAR(SUM([${metric}])), PREVIOUSYEAR(SUM([${metric}])))`, 'percent'],
    ['Conditional ratio', `${metric} above average`, `DIVIDE(COUNTIF([${metric}] > 100), COUNTROWS())`, 'percent'],
  ];

  const save = () => {
    const n = name.trim();
    if (!n || !check.ok) return;
    if (columns.includes(n) || others.some((m) => m.name === n)) { toast('error', `A field named ${n} already exists.`); return; }
    mutateReport((r) => ({ ...r, measures: [...r.measures.filter((m) => m.name !== editing), { name: n, expr, format }] }));
    setName(''); setExpr(''); setEditing(null);
    toast('success', `${n} saved. Add it to any chart from the Fields tab.`);
  };

  const params = report.parameters;
  return (
    <>
      <h3 className="side-h">Quick start</h3>
      <div className="chips">{templates.map(([label, n, e, f]) => <button key={label} className="chip-btn" onClick={() => { setName(n); setExpr(e); setFormat(f); setEditing(null); setCaret(e.length); }}>{label}</button>)}</div>
      <label className="field compact">Measure name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Win rate" /></label>
      <label className="field compact formula">Formula
        <textarea ref={area} spellCheck={false} rows={4} value={expr} placeholder={`SUM([${metric}])`}
          onChange={(e) => { setExpr(e.target.value); setCaret(e.target.selectionStart); }}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)} onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => { if (e.key === 'Tab' && suggestions[0]) { e.preventDefault(); accept(suggestions[0].insert); } }} />
      </label>
      {suggestions.length > 0 && (
        <ul className="suggest" role="listbox" aria-label="Suggestions">
          {suggestions.map((x, i) => <li key={x.label}><button role="option" aria-selected={i === 0} onClick={() => accept(x.insert)}><code>{x.label}</code>{x.doc && <small>{x.doc}</small>}</button></li>)}
        </ul>
      )}
      <div className={`formula-status ${expr && !check.ok ? 'bad' : expr ? 'good' : ''}`} role="status">
        {!expr ? 'Type [ for fields, or start a function name.' : check.ok
          ? <><CheckCircle2 size={14} /> Result for all data: <b>{formatNumber(preview, { format })}</b></>
          : <><AlertTriangle size={14} /> {check.error}</>}
      </div>
      <div className="row-gap">
        <select aria-label="Number format" value={format} onChange={(e) => setFormat(e.target.value as NumberFormat)}>
          <option value="number">Number</option><option value="integer">Whole number</option><option value="currency">Currency</option><option value="percent">Percent</option>
        </select>
        <button className="btn primary sm" disabled={!check.ok || !name.trim()} onClick={save}>{editing ? 'Update' : 'Save measure'}</button>
      </div>

      {report.measures.length > 0 && <>
        <h3 className="side-h">Saved measures</h3>
        <ul className="measure-list">
          {report.measures.map((m) => (
            <li key={m.name}>
              <button className="measure-open" onClick={() => { setName(m.name); setExpr(m.expr); setFormat(m.format ?? 'number'); setEditing(m.name); }}><b>{m.name}</b><code>{m.expr}</code></button>
              {visualId && <button className="icon-btn sm" aria-label={`Add ${m.name} to the selected chart`} title="Add to selected chart" onClick={() => mutateVisual(visualId, (v) => ({ ...v, values: [...v.values, { kind: 'measure', name: m.name }] }))}><Plus size={14} /></button>}
              <button className="icon-btn sm" aria-label={`Delete ${m.name}`} title="Delete" onClick={() => mutateReport((r) => ({ ...r, measures: r.measures.filter((x) => x.name !== m.name) }))}><X size={14} /></button>
            </li>
          ))}
        </ul>
      </>}

      <h3 className="side-h">What-if parameters</h3>
      <p className="hint">Use a parameter in a formula, such as <code>SUM([{metric}]) * (1 + PARAM("Growth"))</code>.</p>
      {params.map((p) => (
        <label key={p.name} className="param"><span>{p.name} <b>{p.value}</b></span>
          <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => mutateReport((r) => ({ ...r, parameters: r.parameters.map((x) => (x.name === p.name ? { ...x, value: Number(e.target.value) } : x)) }), false)} />
        </label>
      ))}
      <button className="btn sm" onClick={() => { const n = `Parameter ${params.length + 1}`; mutateReport((r) => ({ ...r, parameters: [...r.parameters, { name: n, value: 0, min: -1, max: 1, step: 0.01 }] })); }}><Plus size={13} /> Add parameter</button>
    </>
  );
}

function TestsTab({ cs }: { cs: Constraint[] }) {
  const engine = useStore((s) => s.engine)!;
  const metrics = engine.table.columns.filter((c) => c.type === 'number' && c.role !== 'id');
  const groups = engine.table.columns.filter((c) => (c.type === 'category' || c.type === 'boolean') && new Set(c.values).size <= 40);
  const [metric, setMetric] = useState(metrics[0]?.name ?? '');
  const [group, setGroup] = useState(groups[0]?.name ?? '');
  const [group2, setGroup2] = useState(groups[1]?.name ?? '');
  const result = useMemo(() => {
    const out: { tests: TestResult[]; rows: { label: string; n: number; mean: number; low: number; high: number }[]; note?: string } = { tests: [], rows: [] };
    if (!metric || !group) return out;
    const map = engine.groupRows(cs, { col: group });
    const named = [...map.entries()].filter(([k]) => k !== null).map(([k, r]) => ({ label: String(k), xs: engine.numbers(metric, r) })).filter((g) => g.xs.length >= 2);
    out.rows = named.map((g) => { const ci = meanCI(g.xs)!; return { label: g.label, n: g.xs.length, mean: g.xs.reduce((a, b) => a + b, 0) / g.xs.length, low: ci.low, high: ci.high }; });
    if (named.length === 2) out.tests.push(welchT(named[0].xs, named[1].xs), mannWhitney(named[0].xs, named[1].xs));
    else if (named.length > 2) out.tests.push(anova(named.map((g) => g.xs)), kruskalWallis(named.map((g) => g.xs)));
    else out.note = 'At least two groups with two or more values are needed.';
    return out;
  }, [engine, metric, group, cs]);
  const chi = useMemo(() => {
    if (!group || !group2 || group === group2) return null;
    const rows = engine.rows(cs);
    const [a, b] = [engine.column(group)!.values, engine.column(group2)!.values];
    const as: Cell[] = [...new Set(a)].filter((v) => v !== null);
    const bs: Cell[] = [...new Set(b)].filter((v) => v !== null);
    const t = as.map(() => bs.map(() => 0));
    rows.forEach((r) => { const [i, j] = [as.indexOf(a[r]), bs.indexOf(b[r])]; if (i >= 0 && j >= 0) t[i][j]++; });
    const kept = t.filter((r) => r.some((x) => x > 0));
    const colsKept = bs.map((_, j) => j).filter((j) => kept.some((r) => r[j] > 0));
    const clean = kept.map((r) => colsKept.map((j) => r[j]));
    return clean.length > 1 && clean[0].length > 1 ? chiSquare(clean) : null;
  }, [engine, group, group2, cs]);
  const fmtP = (p: number) => (p < 0.001 ? '< 0.001' : p.toFixed(3));
  const Test = ({ t }: { t: TestResult }) => (
    <li className="test"><b>{t.name}</b>
      <span>Statistic <i>{t.statistic.toFixed(3)}</i></span>
      <span>p-value <i>{fmtP(t.p)}</i></span>
      {t.effect !== undefined && <span>{t.effectName} <i>{t.effect.toFixed(3)}</i></span>}
      <em className={t.p < 0.05 ? 'sig' : ''}>{t.p < 0.05 ? 'Difference is statistically significant' : 'No significant difference found'}</em>
    </li>
  );
  if (!metrics.length || !groups.length) return <p className="side-empty">Tests need at least one numeric column and one category column.</p>;
  return (
    <>
      <p className="hint">Check whether differences between groups are real or could be chance. Results follow the current filters.</p>
      <label className="field compact">Metric <select value={metric} onChange={(e) => setMetric(e.target.value)}>{metrics.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
      <label className="field compact">Compare by <select value={group} onChange={(e) => setGroup(e.target.value)}>{groups.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
      {result.note && <p className="hint">{result.note}</p>}
      <ul className="tests">{result.tests.map((t) => <Test key={t.name} t={t} />)}</ul>
      <h3 className="side-h">Average with 95% confidence range</h3>
      <div className="vt small"><table><thead><tr><th>Group</th><th className="num">Rows</th><th className="num">Average</th><th className="num">Range</th></tr></thead>
        <tbody>{result.rows.slice(0, 40).map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{r.n.toLocaleString()}</td><td className="num">{formatNumber(r.mean)}</td><td className="num">{formatNumber(r.low)} to {formatNumber(r.high)}</td></tr>)}</tbody></table></div>
      <h3 className="side-h">Are two categories related?</h3>
      <label className="field compact">Second category <select value={group2} onChange={(e) => setGroup2(e.target.value)}>{groups.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
      {chi ? <ul className="tests"><Test t={chi} /></ul> : <p className="hint">Choose a different category.</p>}
    </>
  );
}

function DataTab() {
  const engine = useStore((s) => s.engine)!;
  const t = engine.table;
  const rows = useMemo(() => t.columns.filter((c) => c.type === 'number').map((c) => {
    const xs = c.values.filter((v): v is number => typeof v === 'number');
    return { c, missing: 1 - xs.length / Math.max(1, t.rowCount) };
  }), [t]);
  return (
    <>
      <p className="hint">{t.rowCount.toLocaleString()} rows and {t.columns.length} columns after corrections.</p>
      <ul className="role-list">
        {rows.map(({ c, missing }) => (
          <li key={c.name}><b>{c.name}</b><small>{measureKind(c)} · {c.role === 'measure' ? 'added up' : c.role === 'ratio' ? 'averaged' : 'never added'} · {formatPct(missing, 0)} blank</small></li>
        ))}
      </ul>
    </>
  );
}

const TABS = ['Design', 'Assistant', 'Fields', 'Findings', 'Measures', 'Stats', 'Data'] as const;
export type SideTab = (typeof TABS)[number];

export function SidePanel({ visual, cs, tab, onTab, onClose }: { visual: Visual | undefined; cs: Constraint[]; tab: SideTab; onTab: (t: SideTab) => void; onClose: () => void }) {
  return (
    <aside className="side" aria-label="Report tools">
      <div className="side-tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>{t}</button>)}
        <button className="icon-btn sm side-close" aria-label="Close panel" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="side-body" role="tabpanel">
        {tab === 'Design' && <DesignPanel />}
        {tab === 'Assistant' && <AssistantPanel cs={cs} />}
        {tab === 'Fields' && <FieldsTab key={visual?.id} visual={visual} />}
        {tab === 'Findings' && <InsightsList cs={cs} limit={20} />}
        {tab === 'Measures' && <MeasuresTab />}
        {tab === 'Stats' && <StatsPanel cs={cs} compare={<TestsTab cs={cs} />} />}
        {tab === 'Data' && <DataTab />}
      </div>
    </aside>
  );
}

export type { FieldRef };
