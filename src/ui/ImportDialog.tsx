// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { nameTaken } from '../core/names';
import { useStore } from '../state/store';
import { Modal } from './common';
import { NameInput } from './NameInput';

const cellText = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? new Date((v as { date: number }).date).toISOString().slice(0, 10) : String(v));

/**
 * Shown when an upload holds tables with different headers. One table is used; tables with the same headers
 * never reach this dialog, because they are combined automatically.
 */
export function ImportDialog() {
  const pending = useStore((s) => s.pending)!;
  const cancel = useStore((s) => s.cancelImport);
  const confirm = useStore((s) => s.confirmImport);
  // The largest table is usually the data. Titles, notes, and summary blocks are smaller.
  const [chosen, setChosen] = useState(() => pending.reduce((best, t, i) => (t.rows.length * t.headers.length > pending[best].rows.length * pending[best].headers.length ? i : best), 0));
  const [names, setNames] = useState(() => pending.map((p) => p.name));
  const [nameError, setNameError] = useState<string | null>(null);
  const t = pending[chosen];

  const rename = (i: number, name: string) => {
    if (nameTaken(name, names.filter((_, k) => k !== i))) { setNameError(`Another table is already named ${name}. Choose a different name.`); return false; }
    setNameError(null);
    setNames((n) => n.map((x, k) => (k === i ? name : x)));
    return true;
  };

  return (
    <Modal title="Choose the table to use" onClose={cancel} wide footer={<>
      <button className="btn" onClick={cancel}>Cancel</button>
      <button className="btn primary" onClick={() => confirm([{ ...pending[chosen], name: names[chosen] }], { mode: 'single' }, names[chosen])}>Continue with {names[chosen]}</button>
    </>}>
      <p className="hint">These tables have different headers, so they are not combined. Choose the one to use.</p>
      <div className="import-grid">
        <ul className="table-list" role="radiogroup" aria-label="Tables">
          {pending.map((p, i) => (
            <li key={i} className={`table-pick ${chosen === i ? 'on' : ''}`} onClick={() => setChosen(i)}>
              <input type="radio" name="table" aria-label={`Use ${names[i]}`} checked={chosen === i} onChange={() => setChosen(i)} />
              <span>
                <NameInput className="name-plain" label={`Table ${i + 1} name`} value={names[i]} onCommit={(name) => rename(i, name)} onFocus={() => setChosen(i)} />
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
    </Modal>
  );
}
