// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useState } from 'react';
import { ChevronDown, MapPin, Search } from 'lucide-react';
import { areaConstraints, areaLevels, areaOptions, areaSummary, tidyAreas, type AreaPick } from '../core/areas';
import type { Cell } from '../core/types';
import { pageConstraints, useStore } from '../state/store';
import { Modal } from './common';

/** Chooses the places to present. Charts, findings, downloads, slides, and video all follow the choice. */
export function AreaPicker() {
  const engine = useStore((s) => s.engine)!;
  const slicers = useStore((s) => s.slicers);
  const selection = useStore((s) => s.selection);
  const setSlicer = useStore((s) => s.setSlicer);
  const setSelection = useStore((s) => s.setSelection);
  const levels = useMemo(() => areaLevels(engine), [engine]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AreaPick>({});
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');

  const current = useMemo(() => {
    const pick: AreaPick = {};
    slicers.filter((x) => !x.part && levels.includes(x.col) && x.values.length).forEach((x) => { pick[x.col] = x.values; });
    return pick;
  }, [slicers, levels]);
  const options = useMemo(() => (open && level ? areaOptions(engine, levels, draft, level) : []), [open, engine, levels, draft, level]);
  if (!levels.length) return null;

  const picked = draft[level] ?? [];
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const others = slicers.filter((x) => x.part || !levels.includes(x.col));
  const records = open ? engine.rows([...pageConstraints(others, null), ...areaConstraints(draft)]).length : 0;
  const chosen = Object.values(current).flat();
  const summary = areaSummary(levels, current);

  const start = () => {
    const narrowest = [...levels].reverse().find((l) => current[l]?.length);
    setDraft(current);
    setLevel(narrowest ?? levels.find((l) => /(municipal|\bcity\b|\btown\b)/i.test(l)) ?? levels[0]);
    setQ('');
    setOpen(true);
  };
  const change = (values: Cell[]) => setDraft(tidyAreas(engine, levels, { ...draft, [level]: values }));
  const apply = (pick: AreaPick) => {
    levels.forEach((col) => setSlicer({ col, values: pick[col] ?? [] }));
    if (selection) setSelection(null);
    setOpen(false);
  };

  return (
    <>
      <button className={`slicer area-button ${chosen.length ? 'active' : ''}`} aria-haspopup="dialog" onClick={start}>
        <MapPin size={14} /><span>Areas</span><b>{!chosen.length ? 'All areas' : chosen.length === 1 ? String(chosen[0]) : `${chosen.length} selected`}</b><ChevronDown size={13} />
      </button>
      {summary && (
        <p className="area-strip" role="status">
          <MapPin size={14} aria-hidden="true" /><span>Showing only <b>{summary}</b></span>
          <button className="link no-print" onClick={start}>Change</button>
          <button className="link no-print" onClick={() => apply({})}>Show all areas</button>
        </p>
      )}
      {open && (
        <Modal wide title="Choose the areas to present" onClose={() => setOpen(false)} footer={<>
          <span className="area-count" role="status">{records.toLocaleString()} of {engine.table.rowCount.toLocaleString()} records</span>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={!records} onClick={() => apply(draft)}>{Object.keys(draft).length ? 'Show selected areas' : 'Show all areas'}</button>
        </>}>
          {levels.length > 1 && (
            <div className="segmented text area-levels" role="radiogroup" aria-label="Area level">
              {levels.map((l) => <button key={l} role="radio" aria-checked={l === level} className={l === level ? 'on' : ''} onClick={() => { setLevel(l); setQ(''); }}>{l}{draft[l]?.length ? ` (${draft[l].length})` : ''}</button>)}
            </div>
          )}
          <div className="area-tools">
            <label className="search-box"><Search size={13} /><input aria-label={`Search ${level}`} placeholder={`Search ${level}`} value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <button className="btn sm" disabled={!shown.length} onClick={() => change([...new Set([...picked, ...shown.map((o) => o.value)])])}>Select all{q.trim() ? ' shown' : ''}</button>
            <button className="btn sm" disabled={!picked.length} onClick={() => change([])}>Clear</button>
          </div>
          {shown.length ? (
            <ul className="area-list" aria-label={`${level} list`}>
              {shown.map((o) => (
                <li key={o.label}><label>
                  <input type="checkbox" checked={picked.includes(o.value)} onChange={() => change(picked.includes(o.value) ? picked.filter((v) => v !== o.value) : [...picked, o.value])} />
                  <span>{o.label}</span><small>{o.count.toLocaleString()}</small>
                </label></li>
              ))}
            </ul>
          ) : <p className="hint">No areas match this search.</p>}
          {!records && <p className="notice warn">No records match these areas and your other filters.</p>}
        </Modal>
      )}
    </>
  );
}
