// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Layers, Plus, Trash2, Unlink } from 'lucide-react';
import { canMerge, checkCombined, combineSources, findOverlaps, matchColumns, mergeColumns, separateColumn, toRawTable, type CombineColumn, type CombineOptions, type CombineSource } from '../core/combine';
import { nameTaken } from '../core/names';
import type { RawTable } from '../core/types';
import { ACCEPT, readFile } from '../ingest';
import { useStore } from '../state/store';
import { Modal } from './common';
import { NameInput } from './NameInput';

/** One added file. `use` lists the sheets or tables of that file that are combined. */
interface Item { key: string; fileName: string; label: string; tables: RawTable[]; use: number[] }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const plainName = (f: string) => f.replace(/\.[^.]+$/, '');
const shapeOf = (t: RawTable) => t.headers.map((h) => String(h ?? '').trim().toLowerCase()).sort().join('\u0001');

export default function CombineDialog({ onClose }: { onClose: () => void }) {
  const confirmImport = useStore((s) => s.confirmImport);
  const [items, setItems] = useState<Item[]>([]);
  const [outputName, setOutputName] = useState('Combined files');
  const [edited, setEdited] = useState<CombineColumn[] | null>(null);
  const [addSource, setAddSource] = useState(true);
  const [sourceHeader, setSourceHeader] = useState('Source File');
  const [removeDuplicates, setRemoveDuplicates] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Every chosen sheet is its own source, so a workbook with monthly sheets can be stacked too.
  const parts = useMemo(() => items.flatMap((it) => it.use.map((k) => ({ item: it, k, label: it.use.length > 1 ? `${it.label} · ${it.tables[k].name}` : it.label }))), [items]);
  const sources = useMemo<CombineSource[]>(() => parts.map(({ item, k, label }) => {
    const t = item.tables[k];
    return { name: label, headers: t.headers.map((h) => String(h ?? '').trim()), rows: t.rows };
  }), [parts]);
  const matched = useMemo(() => matchColumns(sources), [sources]);
  const overlaps = useMemo(() => findOverlaps(sources), [sources]);
  const columns = edited ?? matched;
  const opts: CombineOptions = { addSource, sourceHeader, removeDuplicates };
  const result = useMemo(() => (sources.length >= 2 ? combineSources(sources, columns, opts) : null), [sources, columns, addSource, sourceHeader, removeDuplicates]); // eslint-disable-line react-hooks/exhaustive-deps

  const inAll = columns.filter((c) => c.map.every((p) => p !== null) && !c.similar).length;
  const similar = columns.map((c, i) => ({ c, i })).filter((x) => x.c.similar);
  const partial = columns.map((c, i) => ({ c, i })).filter((x) => x.c.map.some((p) => p === null));
  const change = (next: Item[]) => { setItems(next); setEdited(null); setDone(null); };
  const renameFile = (key: string, label: string) => {
    if (nameTaken(label, items.filter((x) => x.key !== key).map((x) => x.label))) { setError(`Another file is already named ${label}. Choose a different name.`); return false; }
    setError(null); setDone(null);
    setItems((list) => list.map((x) => (x.key === key ? { ...x, label } : x)));
    return true;
  };
  const setUse = (key: string, use: number[]) => change(items.map((x) => (x.key === key ? { ...x, use } : x)));
  const leaveOut = (list: typeof overlaps) => {
    const drop = new Set(list.map((o) => `${parts[o.table].item.key}:${parts[o.table].k}`));
    change(items.map((it) => ({ ...it, use: it.use.filter((k) => !drop.has(`${it.key}:${k}`)) })).filter((it) => it.use.length));
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null); setInfo(null);
    const next = [...items];
    const again: string[] = [];
    for (const f of [...list]) {
      const key = `${f.name}:${f.size}:${f.lastModified}`;
      if (next.some((x) => x.key === key)) { again.push(f.name); continue; }
      try {
        setBusy(`Reading ${f.name}`);
        const tables = await readFile(f, (message) => setBusy(message));
        const largest = tables.reduce((best, t, i) => (t.rows.length > tables[best].rows.length ? i : best), 0);
        let label = plainName(f.name);
        for (let n = 2; nameTaken(label, next.map((x) => x.label)); n++) label = `${plainName(f.name)} (${n})`;
        next.push({ key, fileName: f.name, label, tables, use: [largest] });
      } catch (e) { setError((e as Error).message); }
    }
    if (again.length) setInfo(`${again.join(', ')} ${again.length === 1 ? 'is' : 'are'} already in the list. To combine a copy, save it under another name first.`);
    setBusy(null);
    change(next);
  };

  const finish = async (kind: 'excel' | 'csv' | 'report') => {
    if (!result) return;
    setError(null); setDone(null);
    const problem = checkCombined(sources, columns, result, opts);
    if (problem) { setError(`${problem} Nothing was created.`); return; }
    if (kind === 'report') { confirmImport([toRawTable(result, outputName)], { mode: 'single' }, outputName); onClose(); return; }
    setBusy('Creating the combined file');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const [{ download, safeFileName }, combined] = await Promise.all([import('../export/reportExports'), import('../export/combined')]);
      if (kind === 'csv') download(combined.buildCombinedCsv(result), `${safeFileName(outputName)}.csv`, 'text/csv;charset=utf-8');
      else {
        const buf = await combined.buildCombinedWorkbook(sources, columns, result);
        setBusy('Checking every cell in the finished file');
        await new Promise((r) => setTimeout(r, 30));
        combined.verifyCombinedWorkbook(buf, result);
        download(buf, `${safeFileName(outputName)}.xlsx`, XLSX_MIME);
      }
      setDone(`Combined ${result.rows.length.toLocaleString()} rows from ${sources.length} ${sources.length === 1 ? 'table' : 'tables'}. Every value was checked.`);
    } catch (e) { setError(`${(e as Error).message} Nothing was downloaded.`); }
    setBusy(null);
  };

  const fileList = (c: CombineColumn) => c.map.flatMap((p, s) => (p === null ? [] : [sources[s].name])).join(', ');

  return (
    <Modal wide title="Combine files" onClose={onClose} footer={result ? <>
      <button className="btn" disabled={Boolean(busy)} onClick={() => void finish('csv')}><Download size={15} /> CSV</button>
      <button className="btn" disabled={Boolean(busy)} onClick={() => void finish('report')}>Build report <ArrowRight size={15} /></button>
      <button className="btn primary" disabled={Boolean(busy)} onClick={() => void finish('excel')}><FileSpreadsheet size={15} /> Download Excel</button>
    </> : undefined}>
      <div className={`combine-drop ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}>
        <p>Add two or more files, or one workbook with several sheets. Rows are stacked and columns are lined up by header.</p>
        <button className="btn sm" disabled={Boolean(busy)} onClick={() => input.current?.click()}><Plus size={14} /> Add files</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT} aria-label="Choose files to combine" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {items.length > 0 && (
        <ul className="combine-files">
          {items.map((it, i) => {
            const main = it.tables[it.use[0]];
            const twins = it.tables.map((t, k) => ({ t, k })).filter(({ t, k }) => !it.use.includes(k) && shapeOf(t) === shapeOf(main));
            return (
              <li key={it.key}>
                <FileSpreadsheet size={17} />
                <span>
                  <NameInput className="name-plain" label={`File ${i + 1} name`} value={it.label} onCommit={(label) => renameFile(it.key, label)} />
                  <small title={it.fileName}>{it.fileName} · {it.use.reduce((n, k) => n + it.tables[k].rows.length, 0).toLocaleString()} rows · {main.headers.length} columns{it.use.length > 1 ? ` · ${it.use.length} sheets` : ''}</small>
                  {it.tables.length > 1 && (
                    <details className="combine-sheets">
                      <summary>{it.use.length === 1 ? `Sheet: ${main.name}` : `${it.use.length} of ${it.tables.length} sheets`}</summary>
                      <div>
                        {it.tables.map((t, k) => (
                          <label key={k}><input type="checkbox" checked={it.use.includes(k)} disabled={it.use.length === 1 && it.use.includes(k)} onChange={(e) => setUse(it.key, e.target.checked ? [...it.use, k].sort((a, b) => a - b) : it.use.filter((x) => x !== k))} /> {t.name} <small>{t.rows.length.toLocaleString()} rows</small></label>
                        ))}
                      </div>
                    </details>
                  )}
                </span>
                {twins.length > 0 && <button className="btn sm" title="Add the other sheets that have the same headers" onClick={() => setUse(it.key, [...it.use, ...twins.map((x) => x.k)].sort((a, b) => a - b))}><Layers size={13} /> Add {twins.length} matching {twins.length === 1 ? 'sheet' : 'sheets'}</button>}
                <button className="icon-btn sm" aria-label={`Remove ${it.fileName}`} onClick={() => change(items.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
              </li>
            );
          })}
        </ul>
      )}

      {overlaps.length > 0 && (
        <section className="combine-review" role="alert">
          <h3><AlertTriangle size={15} /> Some rows would be counted twice</h3>
          <ul>{overlaps.map((o) => (
            <li key={o.table}>
              <span><b>{sources[o.table].name}</b><small>{o.same ? 'Has exactly the same rows as' : 'Every row is already in'} {sources[o.within].name}</small></span>
              <button className="btn sm" onClick={() => leaveOut([o])}>Leave it out</button>
            </li>
          ))}</ul>
          <p className="hint">{overlaps.length > 1 && <button className="link" onClick={() => leaveOut(overlaps)}>Leave out all {overlaps.length}</button>}{overlaps.length > 1 ? ' or ' : ''}switch on <b>Remove rows that are exactly the same</b> below.</p>
        </section>
      )}

      {result && <>
        <label className="field compact report-name">Combined file name <NameInput label="Combined file name" value={outputName} onCommit={setOutputName} /></label>
        <dl className="combine-stats">
          <div><dt>Combined rows</dt><dd>{result.rows.length.toLocaleString()}</dd></div>
          <div><dt>Columns</dt><dd>{columns.length}</dd></div>
          <div><dt>In every file</dt><dd>{inAll}</dd></div>
          <div><dt>To review</dt><dd>{similar.length + partial.length}</dd></div>
        </dl>

        {similar.length > 0 && (
          <section className="combine-review">
            <h3><AlertTriangle size={15} /> Similar headers were matched</h3>
            <p className="hint">Keep the match if these are the same question.</p>
            <ul>{similar.map(({ c, i }) => (
              <li key={c.name}>
                <span>{c.map.flatMap((p, s) => (p === null ? [] : [sources[s].headers[p]])).join('  =  ')}</span>
                <button className="btn sm" onClick={() => setEdited(separateColumn(columns, i, sources))}><Unlink size={13} /> Keep separate</button>
              </li>
            ))}</ul>
          </section>
        )}

        {partial.length > 0 && (
          <section className="combine-review">
            <h3><AlertTriangle size={15} /> Columns not found in every file</h3>
            <p className="hint">These columns are kept, and rows from the other files are left blank. If one means the same as another column, match them here.</p>
            <ul>{partial.map(({ c, i }) => {
              const options = columns.map((o, k) => ({ o, k })).filter(({ o }) => canMerge(c, o));
              return (
                <li key={c.name}>
                  <span><b>{c.name}</b><small>Only in {fileList(c)}</small></span>
                  {options.length > 0 && <select aria-label={`Match ${c.name} with another column`} value="" onChange={(e) => { if (e.target.value) setEdited(mergeColumns(columns, Number(e.target.value), i)); }}>
                    <option value="">Keep as its own column</option>
                    {options.map(({ o, k }) => <option key={k} value={k}>Same as {o.name}</option>)}
                  </select>}
                </li>
              );
            })}</ul>
          </section>
        )}

        <fieldset className="combine-options">
          <legend>Options</legend>
          <label className="switch"><input type="checkbox" checked={addSource} onChange={(e) => setAddSource(e.target.checked)} /><i /><span>Add a column showing which file each row came from</span></label>
          {addSource && <label className="field compact">Column name <input value={sourceHeader} onChange={(e) => setSourceHeader(e.target.value)} /></label>}
          <label className="switch"><input type="checkbox" checked={removeDuplicates} onChange={(e) => setRemoveDuplicates(e.target.checked)} /><i /><span>Remove rows that are exactly the same{removeDuplicates ? ` (${result.duplicatesRemoved.toLocaleString()} removed)` : ''}</span></label>
        </fieldset>
      </>}

      {sources.length === 1 && <p className="hint">Add at least one more file, or choose another sheet from this workbook.</p>}
      <div role="status" aria-live="polite">
        {busy && <p className="notice"><span className="spinner sm" /> {busy}</p>}
        {info && <p className="notice warn">{info}</p>}
        {error && <p className="notice bad">{error}</p>}
        {done && <p className="notice good"><CheckCircle2 size={16} /> {done}</p>}
      </div>
    </Modal>
  );
}
