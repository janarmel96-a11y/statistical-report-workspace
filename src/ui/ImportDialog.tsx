// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { nameTaken } from '../core/names';
import { uniqueHeaders } from '../core/parse';
import type { RawTable } from '../core/types';
import type { CombineConfig } from '../state/persist';
import { useStore } from '../state/store';
import { Modal } from './common';
import { NameInput } from './NameInput';

const cellText = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? new Date((v as { date: number }).date).toISOString().slice(0, 10) : String(v));

export function ImportDialog() {
  const pending = useStore((s) => s.pending)!;
  const cancel = useStore((s) => s.cancelImport);
  const confirm = useStore((s) => s.confirmImport);
  const [chosen, setChosen] = useState<number[]>([0]);
  const [preview, setPreview] = useState(0);
  const [mode, setMode] = useState<'append' | 'join'>('append');
  const [names, setNames] = useState(() => pending.map((p) => p.name));
  const [reportName, setReportName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const tables: RawTable[] = chosen.map((i) => pending[i]);
  const shared = useMemo(() => {
    if (tables.length < 2) return [];
    const sets = tables.map((t) => new Set(uniqueHeaders(t.headers)));
    return [...sets[0]].filter((h) => sets.every((s) => s.has(h)));
  }, [tables]);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const leftCols = tables[0] ? uniqueHeaders(tables[0].headers) : [];
  const rightCols = tables[1] ? uniqueHeaders(tables[1].headers) : [];
  const leftKey = left || shared[0] || leftCols[0];
  const rightKey = right || (shared.includes(leftKey) ? leftKey : rightCols[0]);
  const t = pending[preview];

  const defaultName = tables.length > 1 && mode === 'append' ? 'Combined files' : names[chosen[0]] ?? '';
  const rename = (i: number, name: string) => {
    if (nameTaken(name, names.filter((_, k) => k !== i))) { setNameError(`Another table is already named ${name}. Choose a different name.`); return false; }
    setNameError(null);
    setNames((n) => n.map((x, k) => (k === i ? name : x)));
    return true;
  };
  const submit = () => {
    const combine: CombineConfig = tables.length === 1 ? { mode: 'single' } : mode === 'append' ? { mode: 'append' } : { mode: 'join', leftKey, rightKey };
    confirm(chosen.map((i) => ({ ...pending[i], name: names[i] })), combine, tables.length > 1 ? reportName ?? defaultName : names[chosen[0]]);
  };

  return (
    <Modal title="Choose the tables to use" onClose={cancel} wide footer={<>
      <button className="btn" onClick={cancel}>Cancel</button>
      <button className="btn primary" disabled={!chosen.length} onClick={submit}>Continue with {chosen.length} table{chosen.length === 1 ? '' : 's'}</button>
    </>}>
      <div className="import-grid">
        <ul className="table-list">
          {pending.map((p, i) => (
            <li key={i} className={`table-pick ${preview === i ? 'on' : ''}`} onClick={() => setPreview(i)}>
              <input type="checkbox" aria-label={`Use ${names[i]}`} checked={chosen.includes(i)} onChange={(e) => { setChosen((c) => (e.target.checked ? [...c, i].sort((a, b) => a - b) : c.filter((x) => x !== i))); setPreview(i); }} />
              <span>
                <NameInput className="name-plain" label={`Table ${i + 1} name`} value={names[i]} onCommit={(name) => rename(i, name)} onFocus={() => setPreview(i)} />
                <small title={p.source}>{p.source} · {p.rows.length.toLocaleString()} rows · {p.headers.length} columns{p.confidence !== undefined ? ` · ${Math.round(p.confidence * 100)}% read confidence` : ''}</small>
              </span>
            </li>
          ))}
        </ul>
        <div className="import-preview">
          {t.note && <p className="notice warn"><AlertTriangle size={15} /> {t.note}</p>}
          <div className="mini-table" tabIndex={0} aria-label={`Preview of ${t.name}`}>
            <table>
              <thead><tr>{t.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{t.rows.slice(0, 12).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{cellText(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
      {nameError && <p className="notice bad" role="alert">{nameError}</p>}
      {tables.length > 1 && <label className="field compact report-name">Report name <NameInput label="Report name" value={reportName ?? defaultName} onCommit={setReportName} /></label>}
      {tables.length > 1 && (
        <fieldset className="combine">
          <legend>How should these tables be combined?</legend>
          <label><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> <span><b>Stack rows</b> for tables with the same columns, such as monthly files</span></label>
          <label><input type="radio" checked={mode === 'join'} onChange={() => setMode('join')} /> <span><b>Match rows</b> to add columns from a lookup table</span></label>
          {mode === 'join' && (
            <div className="join-keys">
              <label>Match on <select value={leftKey} onChange={(e) => setLeft(e.target.value)}>{leftCols.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>equals <select value={rightKey} onChange={(e) => setRight(e.target.value)}>{rightCols.map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
          )}
        </fieldset>
      )}
    </Modal>
  );
}
