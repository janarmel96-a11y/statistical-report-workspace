// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info, Redo2, Undo2 } from 'lucide-react';
import { formatCell, formatPct } from '../core/format';
import { measureKind } from '../core/analytics';
import { profileColumn } from '../core/insights';
import { auditTrail, outlierLimits, ruleViolations } from '../core/recipe';
import type { Cell, ColRole, ColType, Column, FillStrategy, Finding } from '../core/types';
import { useStore } from '../state/store';
import { Logo, Modal, ThemeSwitch } from './common';

const ROW_H = 32;
const COL_W = 168;
const TYPES: [ColType, string][] = [['number', 'Number'], ['date', 'Date'], ['category', 'Category'], ['text', 'Text'], ['boolean', 'Yes/No']];
const ROLES: [ColRole, string][] = [['measure', 'Metric: add up'], ['ratio', 'Rate: average'], ['id', 'ID: never add'], ['dimension', 'Group by'], ['date', 'Date'], ['text', 'Notes']];

function FindingCard({ f }: { f: Finding }) {
  const disabled = useStore((s) => s.disabled.includes(f.id));
  const toggle = useStore((s) => s.toggleFinding);
  const fixable = f.steps.length > 0;
  const Icon = f.severity === 'error' ? AlertCircle : f.severity === 'warning' ? AlertTriangle : Info;
  return (
    <li className={`finding ${f.severity}`}>
      <div className="finding-head"><Icon size={16} aria-label={f.severity} /><b>{f.title}</b></div>
      <p>{f.detail}</p>
      {fixable && (
        <label className="switch">
          <input type="checkbox" checked={!disabled} onChange={() => toggle(f.id)} />
          <i /> <span>{disabled ? 'Not applied' : 'Correction applied'}</span>
        </label>
      )}
    </li>
  );
}

type Tool = 'rename' | 'fill' | 'split' | 'merge' | 'outliers' | 'rule' | null;

function ColumnTools({ col }: { col: Column }) {
  const addStep = useStore((s) => s.addStep);
  const table = useStore((s) => s.table)!;
  const [tool, setTool] = useState<Tool>(null);
  const [text, setText] = useState('');
  const [strategy, setStrategy] = useState<FillStrategy>(col.type === 'number' ? 'median' : 'mode');
  const [others, setOthers] = useState<string[]>([]);
  const missing = useMemo(() => col.values.filter((v) => v === null).length, [col]);
  const limits = useMemo(() => (col.type === 'number' ? outlierLimits(col) : null), [col]);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [allowed, setAllowed] = useState('');
  const [required, setRequired] = useState(false);
  const [action, setAction] = useState<'exclude' | 'blank'>('exclude');
  const rule = { required: required || undefined, min: min === '' ? undefined : Number(min), max: max === '' ? undefined : Number(max), allowed: allowed.trim() ? allowed.split(',').map((a) => a.trim()).filter(Boolean) : undefined };
  const violations = tool === 'rule' ? ruleViolations(col, rule).length : 0;
  const open = (t: Tool, initial = '') => { setTool(t); setText(initial); setOthers([]); };
  const close = () => setTool(null);
  return (
    <div className="col-tools" aria-label={`Tools for ${col.name}`}>
      <b className="col-name">{col.name}</b>
      <label>Type <select value={col.type} onChange={(e) => addStep({ op: 'setType', col: col.name, type: e.target.value as ColType })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Use as <select value={col.role} onChange={(e) => addStep({ op: 'setRole', col: col.name, role: e.target.value as ColRole })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <button className="btn sm" onClick={() => open('rename', col.name)}>Rename</button>
      <button className="btn sm" disabled={!missing} onClick={() => open('fill')}>Fill {missing ? `${missing.toLocaleString()} blank` : 'blanks'}</button>
      <button className="btn sm" disabled={!missing} onClick={() => addStep({ op: 'dropMissing', col: col.name })}>Remove blank rows</button>
      <button className="btn sm" onClick={() => open('split', ',')}>Split</button>
      <button className="btn sm" onClick={() => open('merge', col.name)}>Merge</button>
      {col.type === 'number' && <button className="btn sm" disabled={!limits?.count} onClick={() => open('outliers')}>Outliers{limits?.count ? ` (${limits.count.toLocaleString()})` : ''}</button>}
      <button className="btn sm" onClick={() => open('rule')}>Add rule</button>
      <button className="btn sm danger" onClick={() => addStep({ op: 'drop', col: col.name })}>Remove column</button>

      {tool === 'outliers' && limits && (
        <Modal title={`Outliers in ${col.name}`} onClose={close} footer={<>
          <button className="btn" onClick={() => { addStep({ op: 'outliers', col: col.name, method: 'cap' }); close(); }}>Cap at the limits</button>
          <button className="btn primary" onClick={() => { addStep({ op: 'outliers', col: col.name, method: 'remove' }); close(); }}>Remove {limits.count.toLocaleString()} rows</button>
        </>}>
          <p>{limits.count.toLocaleString()} values fall outside the usual range of {formatCell(limits.low, col)} to {formatCell(limits.high, col)}.</p>
          <p className="hint">Check these before changing them, because an unusual value can be correct. You can undo this at any time.</p>
        </Modal>
      )}
      {tool === 'rule' && (
        <Modal title={`Validation rule for ${col.name}`} onClose={close} footer={<button className="btn primary" disabled={!violations} onClick={() => { addStep({ op: 'rule', col: col.name, rule, action }); close(); }}>Apply to {violations.toLocaleString()} rows</button>}>
          <label className="switch"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /><i /><span>A value is required</span></label>
          {col.type === 'number' ? <div className="two"><label className="field">Lowest allowed <input type="number" value={min} onChange={(e) => setMin(e.target.value)} /></label><label className="field">Highest allowed <input type="number" value={max} onChange={(e) => setMax(e.target.value)} /></label></div>
            : <label className="field">Allowed values, separated by commas <input value={allowed} onChange={(e) => setAllowed(e.target.value)} /></label>}
          <label className="field">Rows that break the rule <select value={action} onChange={(e) => setAction(e.target.value as 'exclude' | 'blank')}><option value="exclude">Exclude the row</option><option value="blank">Blank this value</option></select></label>
          <p className="hint" role="status">{violations.toLocaleString()} rows break this rule.</p>
        </Modal>
      )}
      {tool === 'rename' && (
        <Modal title="Rename column" onClose={close} footer={<button className="btn primary" onClick={() => { addStep({ op: 'rename', col: col.name, name: text }); close(); }}>Rename</button>}>
          <label className="field">New name <input autoFocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
      {tool === 'fill' && (
        <Modal title={`Fill blanks in ${col.name}`} onClose={close} footer={<button className="btn primary" onClick={() => { addStep({ op: 'fill', col: col.name, strategy, value: col.type === 'number' ? Number(text) : text }); close(); }}>Fill {missing.toLocaleString()} blanks</button>}>
          <label className="field">Fill with
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as FillStrategy)}>
              {col.type === 'number' && <><option value="median">Median</option><option value="mean">Average</option><option value="zero">Zero</option></>}
              <option value="mode">Most common value</option><option value="forward">Value from the row above</option><option value="value">A specific value</option>
            </select>
          </label>
          {strategy === 'value' && <label className="field">Value <input value={text} onChange={(e) => setText(e.target.value)} /></label>}
          <p className="hint">Filling blanks changes averages and totals. The change can be undone at any time.</p>
        </Modal>
      )}
      {tool === 'split' && (
        <Modal title={`Split ${col.name}`} onClose={close} footer={<button className="btn primary" disabled={!text} onClick={() => { addStep({ op: 'split', col: col.name, sep: text, names: [] }); close(); }}>Split column</button>}>
          <label className="field">Split at this character <input autoFocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
      {tool === 'merge' && (
        <Modal title={`Merge ${col.name} with other columns`} onClose={close} footer={<button className="btn primary" disabled={!others.length || !text.trim()} onClick={() => { addStep({ op: 'merge', cols: [col.name, ...others], sep: ' ', name: text }); close(); }}>Merge columns</button>}>
          <fieldset className="check-list"><legend>Columns to add</legend>
            {table.columns.filter((c) => c.name !== col.name).map((c) => (
              <label key={c.name}><input type="checkbox" checked={others.includes(c.name)} onChange={(e) => setOthers((o) => (e.target.checked ? [...o, c.name] : o.filter((x) => x !== c.name)))} /> {c.name}</label>
            ))}
          </fieldset>
          <label className="field">New column name <input value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
    </div>
  );
}

function DataGrid({ selected, onSelect }: { selected: string | null; onSelect: (c: string) => void }) {
  const table = useStore((s) => s.table)!;
  const findings = useStore((s) => s.findings);
  const disabled = useStore((s) => s.disabled);
  const host = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(640);
  const changed = useMemo(() => {
    const m = new Map<string, Cell>();
    findings.filter((f) => !disabled.includes(f.id)).forEach((f) => f.changes.forEach((c) => m.set(`${c.row}|${c.column}`, c.before)));
    return m;
  }, [findings, disabled]);
  const profiles = useMemo(() => table.columns.map((c) => {
    const missing = c.values.filter((v) => v === null).length;
    return { missing: table.rowCount ? missing / table.rowCount : 0 };
  }), [table]);
  const first = Math.max(0, Math.floor(top / ROW_H) - 6);
  const count = Math.ceil(height / ROW_H) + 12;
  const rows = Array.from({ length: Math.min(count, table.rowCount - first) }, (_, i) => first + i);
  const width = 64 + table.columns.length * COL_W;
  return (
    <div className="grid" ref={host} tabIndex={0} aria-label="Data preview" role="grid" aria-rowcount={table.rowCount}
      onScroll={(e) => { setTop(e.currentTarget.scrollTop); setHeight(e.currentTarget.clientHeight); }}>
      <div className="grid-inner" style={{ width, height: table.rowCount * ROW_H + 62 }}>
        <div className="grid-head" style={{ width }} role="row">
          <div className="grid-rownum head">#</div>
          {table.columns.map((c, i) => (
            <button key={c.name} role="columnheader" className={`grid-th ${selected === c.name ? 'on' : ''}`} style={{ width: COL_W }} onClick={() => onSelect(c.name)} title={`${c.name}: select to edit`}>
              <span className="th-name">{c.name}</span>
              <span className="th-meta"><em className={`type-${c.type}`}>{TYPES.find(([t]) => t === c.type)?.[1]}</em>{profiles[i].missing > 0 ? <small>{formatPct(profiles[i].missing, 0)} blank</small> : <small>Complete</small>}</span>
              <span className="th-bar"><i style={{ width: `${(1 - profiles[i].missing) * 100}%` }} /></span>
            </button>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r} className="grid-row" role="row" style={{ top: r * ROW_H + 62, width }}>
            <div className="grid-rownum">{table.rowIds[r] + 2}</div>
            {table.columns.map((c) => {
              const v = c.values[r];
              const key = `${table.rowIds[r]}|${c.name}`;
              const fixed = changed.has(key);
              return (
                <div key={c.name} role="gridcell" style={{ width: COL_W }} className={`grid-td ${c.type === 'number' ? 'num' : ''} ${v === null ? 'blank' : ''} ${fixed ? 'fixed' : ''} ${selected === c.name ? 'sel' : ''}`}
                  title={fixed ? `Corrected. Original value: ${changed.get(key) ?? 'blank'}` : undefined}>
                  {v === null ? 'blank' : formatCell(v, c)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnSummary({ col, rows }: { col: Column; rows: number }) {
  const p = useMemo(() => profileColumn(col, rows), [col, rows]);
  const f = (v?: number) => (v === undefined ? '–' : formatCell(v, col));
  return (
    <dl className="col-summary">
      <div><dt>Kind</dt><dd>{measureKind(col)}</dd></div>
      <div><dt>Values</dt><dd>{p.count.toLocaleString()}</dd></div>
      <div><dt>Distinct</dt><dd>{p.distinct.toLocaleString()}</dd></div>
      {col.type === 'number' && <>
        <div><dt>Average</dt><dd>{f(p.mean)}</dd></div>
        <div><dt>Median</dt><dd>{f(p.median)}</dd></div>
        <div><dt>Lowest</dt><dd>{f(p.min)}</dd></div>
        <div><dt>Highest</dt><dd>{f(p.max)}</dd></div>
        <div><dt>Outliers</dt><dd>{(p.outliersIqr ?? 0).toLocaleString()}</dd></div>
      </>}
    </dl>
  );
}

export function Prepare() {
  const s = useStore();
  const table = s.table!;
  const [selected, setSelected] = useState<string | null>(null);
  const col = table.columns.find((c) => c.name === selected);
  const q = s.quality;
  const errors = s.findings.filter((f) => f.severity === 'error').length;
  const corrected = s.findings.filter((f) => !s.disabled.includes(f.id)).reduce((n, f) => n + f.changes.length, 0);
  const trail = auditTrail(s.findings, s.disabled, s.steps);
  const meters: [string, number][] = q ? [['Complete', q.completeness], ['Valid', q.validity], ['Unique', q.uniqueness], ['Consistent', q.consistency]] : [];
  return (
    <div className="prepare">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back to home" title="Back to home" onClick={() => s.setRoute('home')}><ArrowLeft size={18} /></button>
        <Logo />
        <div className="topbar-title"><b>{s.projectName}</b><small>{table.rowCount.toLocaleString()} rows · {table.columns.length} columns</small></div>
        <div className="spacer" />
        <button className="icon-btn" aria-label="Undo" title="Undo" disabled={!s.steps.length} onClick={s.undoStep}><Undo2 size={17} /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo" disabled={!s.redoSteps.length} onClick={s.redoStep}><Redo2 size={17} /></button>
        <label className="inline">Dates <select value={s.locale.dateOrder} onChange={(e) => s.setLocale({ ...s.locale, dateOrder: e.target.value as typeof s.locale.dateOrder })}>
          <option value="auto">Detect</option><option value="mdy">Month first</option><option value="dmy">Day first</option>
        </select></label>
        <label className="inline">Numbers <select value={s.locale.numberLocale} onChange={(e) => s.setLocale({ ...s.locale, numberLocale: e.target.value as typeof s.locale.numberLocale })}>
          <option value="auto">Detect</option><option value="dot">1,234.56</option><option value="comma">1.234,56</option>
        </select></label>
        <ThemeSwitch />
        <button className="btn primary" onClick={s.buildReport}>{s.report ? 'Update report' : 'Build report'} <ArrowRight size={16} /></button>
      </header>
      <div className="prepare-body">
        <aside className="health" aria-label="Data checks">
          {q && (
            <section className="score">
              <div className="score-num"><strong>{q.score}</strong><span>/100</span></div>
              <div><b>Data quality when uploaded</b><p>{errors ? `${errors} calculation or data problem${errors > 1 ? 's' : ''} found` : 'No calculation problems found'}{corrected ? `, ${corrected.toLocaleString()} value${corrected > 1 ? 's' : ''} corrected` : ''}.</p></div>
              <div className="meters">{meters.map(([l, v]) => <div key={l}><span>{l}</span><div className="meter"><i style={{ width: `${v * 100}%` }} /></div><small>{Math.round(v * 100)}%</small></div>)}</div>
            </section>
          )}
          <h2>Checks and corrections</h2>
          {s.findings.length ? <ul className="findings">{s.findings.map((f) => <FindingCard key={f.id} f={f} />)}</ul>
            : <p className="clean"><CheckCircle2 size={16} /> Every check passed.</p>}
          <details className="trail">
            <summary>Audit trail ({trail.length})</summary>
            {trail.length ? <ol>{trail.map((e, i) => <li key={i}><b>{e.action}</b><small>{e.source} · {e.status}</small></li>)}</ol> : <p className="hint">No changes have been made.</p>}
          </details>
        </aside>
        <main className="staging">
          {col ? <><ColumnTools key={col.name} col={col} /><ColumnSummary col={col} rows={table.rowCount} /></> : <p className="staging-hint">Select a column heading to change its type, fill blanks, or merge and split it. Corrected cells are highlighted, and hovering shows the original value.</p>}
          <DataGrid selected={selected} onSelect={setSelected} />
        </main>
      </div>
    </div>
  );
}
