// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Plus, Trash2, Unlink } from 'lucide-react';
import { canMerge, checkCombined, combineSources, matchColumns, mergeColumns, separateColumn, toRawTable, type CombineColumn, type CombineOptions, type CombineSource } from '../core/combine';
import { nameTaken } from '../core/names';
import type { RawTable } from '../core/types';
import { ACCEPT, readFile } from '../ingest';
import { useStore } from '../state/store';
import { Modal } from './common';
import { NameInput } from './NameInput';

interface Item { key: string; fileName: string; label: string; tables: RawTable[]; table: number }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const plainName = (f: string) => f.replace(/\.[^.]+$/, '');

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
  const [done, setDone] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const sources = useMemo<CombineSource[]>(() => items.map((it) => {
    const t = it.tables[it.table];
    return { name: it.label, headers: t.headers.map((h) => String(h ?? '').trim()), rows: t.rows };
  }), [items]);
  const matched = useMemo(() => matchColumns(sources), [sources]);
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

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const next = [...items];
    for (const f of [...list]) {
      const key = `${f.name}:${f.size}`;
      if (next.some((x) => x.key === key)) continue;
      try {
        setBusy(`Reading ${f.name}`);
        const tables = await readFile(f, (message) => setBusy(message));
        const largest = tables.reduce((best, t, i) => (t.rows.length > tables[best].rows.length ? i : best), 0);
        let label = plainName(f.name);
        for (let n = 2; nameTaken(label, next.map((x) => x.label)); n++) label = `${plainName(f.name)} (${n})`;
        next.push({ key, fileName: f.name, label, tables, table: largest });
      } catch (e) { setError((e as Error).message); }
    }
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
      setDone(`Combined ${result.rows.length.toLocaleString()} rows from ${sources.length} files. Every value was checked.`);
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
        <p>Add two or more files. Rows are stacked and columns are lined up by header.</p>
        <button className="btn sm" disabled={Boolean(busy)} onClick={() => input.current?.click()}><Plus size={14} /> Add files</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT} aria-label="Choose files to combine" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {items.length > 0 && (
        <ul className="combine-files">
          {items.map((it, i) => (
            <li key={it.key}>
              <FileSpreadsheet size={17} />
              <span>
                <NameInput className="name-plain" label={`File ${i + 1} name`} value={it.label} onCommit={(label) => renameFile(it.key, label)} />
                <small title={it.fileName}>{it.fileName} · {it.tables[it.table].rows.length.toLocaleString()} rows · {it.tables[it.table].headers.length} columns</small>
              </span>
              {it.tables.length > 1 && <select aria-label={`Table to use from ${it.fileName}`} value={it.table} onChange={(e) => change(items.map((x, k) => (k === i ? { ...x, table: Number(e.target.value) } : x)))}>{it.tables.map((t, k) => <option key={k} value={k}>{t.name}</option>)}</select>}
              <button className="icon-btn sm" aria-label={`Remove ${it.fileName}`} onClick={() => change(items.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
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

      {items.length === 1 && <p className="hint">Add at least one more file to combine.</p>}
      <div role="status" aria-live="polite">
        {busy && <p className="notice"><span className="spinner sm" /> {busy}</p>}
        {error && <p className="notice bad">{error}</p>}
        {done && <p className="notice good"><CheckCircle2 size={16} /> {done}</p>}
      </div>
    </Modal>
  );
}
