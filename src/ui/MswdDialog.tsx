// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2, FileSpreadsheet, Info, Plus, Trash2, XCircle } from 'lucide-react';
import {
  checkReport, CLASSES, compareWithSheet, computeReport, detectColumns, FIELD_LABELS, lineValues, missingRequired, overallLabel,
  PATIENT_TYPES, planEntryCleanup, prepare, withMerges, workerChecks, workerNames, type MswdCheck, type MswdColumns, type MswdField,
} from '../core/mswd';
import { analyzeMswd } from '../core/mswdAnalyst';
import { chooseSources, stackSources, type SourceTable } from '../core/mswdSources';
import type { RawCell, RawTable } from '../core/types';
import { ACCEPT, MAX_FILE_BYTES, readFile } from '../ingest';
import { useStore } from '../state/store';
import { Modal } from './common';

/** One added file, its tables, and the cell layout of an MSWD PERFORMANCE sheet when the file has one. */
interface Item { key: string; fileName: string; tables: RawTable[]; grid?: RawCell[][] }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FIELDS: MswdField[] = ['month', 'date', 'timestamp', 'worker', 'patientType', 'patientStatus', 'typeOfPatient', 'classification', 'service', 'hospitalNo', 'barangay', 'municipality', 'province', 'region', 'barangayError', 'municipalityError', 'provinceError', 'regionError', 'totalErrors'];
const n = (v: number) => v.toLocaleString('en-US');
const tick = () => new Promise((r) => setTimeout(r, 30));

async function readOne(f: File, onProgress: (m: string) => void): Promise<Pick<Item, 'tables' | 'grid'>> {
  const spreadsheet = /\.(xlsx|xlsm|xls)$/i.test(f.name);
  if (!spreadsheet) return { tables: await readFile(f, onProgress) };
  if (f.size > MAX_FILE_BYTES) throw new Error(`${f.name} is larger than the 200 MB limit.`);
  onProgress(`Reading ${f.name}`);
  await tick();
  const { readWorkbookWithGrids } = await import('../ingest/readers');
  try {
    const { tables, grids } = readWorkbookWithGrids(await f.arrayBuffer(), f.name, (name) => /^\s*MSWD PERFORMANCE\s*$/i.test(name));
    if (!tables.length) throw new Error(`No table of data was found in ${f.name}.`);
    return { tables, grid: [...grids.values()][0] };
  } catch (e) {
    throw new Error((e as Error).message.startsWith('No table') ? (e as Error).message : `${f.name} could not be read. It may be damaged or password protected.`);
  }
}

function CheckIcon({ level }: { level: MswdCheck['level'] }) {
  if (level === 'good') return <CheckCircle2 size={15} className="good" />;
  if (level === 'bad') return <XCircle size={15} className="bad" />;
  if (level === 'warn') return <AlertTriangle size={15} className="warn" />;
  return <Info size={15} className="info" />;
}

/** `initial` holds the files dropped on the home page, so the report is ready when the dialog opens. */
export default function MswdDialog({ onClose, initial }: { onClose: () => void; initial?: { tables: RawTable[]; grid?: RawCell[][] } }) {
  const confirmImport = useStore((s) => s.confirmImport);
  const [items, setItems] = useState<Item[]>(() => {
    if (!initial) return [];
    const byFile = new Map<string, RawTable[]>();
    for (const t of initial.tables) byFile.set(t.source, [...(byFile.get(t.source) ?? []), t]);
    return [...byFile].map(([fileName, tables], i) => ({ key: `upload:${i}:${fileName}`, fileName, tables, grid: i === 0 ? initial.grid : undefined }));
  });
  const [useOverride, setUseOverride] = useState<Record<string, boolean>>({});
  const [colOverride, setColOverride] = useState<MswdColumns>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [merges, setMerges] = useState<Map<string, string>>(new Map());
  const [department, setDepartment] = useState('MALASAKIT CENTER');
  const [monthSheets, setMonthSheets] = useState(true);
  const [trim, setTrim] = useState(true);
  const [block, setBlock] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLDivElement>(null);
  // Progress and results are shown at the end of a long dialog, so bring them into view.
  useEffect(() => { if (busy || error || done) status.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [busy, error, done]);

  const list = useMemo<(SourceTable & { key: string })[]>(() => items.flatMap((it) => it.tables.map((t, k) => {
    const file = it.fileName.replace(/\.[^.]+$/, '');
    const label = it.tables.length === 1 && (items.length > 1 || t.name === file) ? file : items.length > 1 ? `${file} · ${t.name}` : t.name;
    return { key: `${it.key}:${k}`, label, table: t };
  })), [items]);
  const auto = useMemo(() => chooseSources(list), [list]);
  const use = useMemo(() => list.map((s, i) => useOverride[s.key] ?? auto[i].use), [list, auto, useOverride]);
  const stacked = useMemo(() => stackSources(list, use), [list, use]);
  const cols = useMemo<MswdColumns>(() => {
    const found = detectColumns(stacked.headers);
    for (const f of FIELDS) if (f in colOverride) { const v = colOverride[f]; if (v === undefined || v < 0) delete found[f]; else found[f] = v; }
    return found;
  }, [stacked.headers, colOverride]);
  const missing = stacked.rows.length ? missingRequired(cols) : [];
  const autoPlan = useMemo(() => (stacked.rows.length && !missing.length ? planEntryCleanup(stacked.headers, stacked.rows, cols) : []), [stacked, cols, missing.length]);
  const plan = useMemo(() => (cols.worker === undefined ? autoPlan : withMerges(autoPlan, stacked.headers, stacked.rows, cols.worker, merges)), [autoPlan, stacked, cols.worker, merges]);
  const result = useMemo(() => {
    if (!stacked.rows.length || missing.length) return null;
    // With Auto trim and correct off, every entry stays exactly as typed, the counted columns included.
    const off = trim ? skip : new Set(plan.flatMap((c) => c.fixes.map((f) => `${c.col}\u0001${f.from}`)));
    const p = prepare(stacked.headers, stacked.rows, cols, plan, off, { trim });
    const report = computeReport(p, workerNames(p));
    return { p, report, checks: checkReport(p, report) };
  }, [stacked, cols, plan, skip, missing.length, trim]);
  const grid = items.find((it) => it.grid)?.grid;
  // The report sheet already in the file is compared with the data as it was entered, so its own formulas are judged.
  const comparison = useMemo(() => {
    if (!grid || !result) return null;
    const raw = prepare(stacked.headers, stacked.rows, cols, []);
    return compareWithSheet(grid, computeReport(raw, workerNames(raw)));
  }, [grid, result, stacked, cols]);
  const similar = useMemo(() => (result ? workerChecks(result.p, result.report.workers).filter((w) => w.similarTo) : []), [result]);
  const brief = useMemo(() => (result ? analyzeMswd(result.p, result.report, result.checks) : null), [result]);

  const change = (next: Item[]) => { setItems(next); setDone(null); setError(null); setBlock(-1); };
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null); setDone(null);
    const next = [...items];
    for (const f of [...files]) {
      const key = `${f.name}:${f.size}:${f.lastModified}`;
      if (next.some((x) => x.key === key)) continue;
      try {
        setBusy(`Reading ${f.name}`);
        next.push({ key, fileName: f.name, ...(await readOne(f, (m) => setBusy(m))) });
      } catch (e) { setError((e as Error).message); }
    }
    setBusy(null);
    change(next);
  };

  const download = async () => {
    if (!result) return;
    setError(null); setDone(null);
    setBusy('Building the MSWD performance workbook');
    await tick();
    try {
      const [{ download: save }, book] = await Promise.all([import('../export/reportExports'), import('../export/mswdWorkbook')]);
      const buf = await book.buildMswdWorkbook(result.p, result.report, result.checks, { ...book.DEFAULT_OPTIONS, department: department.trim() || book.DEFAULT_OPTIONS.department, monthSheets }, (m) => setBusy(m));
      setBusy('Checking every number in the finished workbook');
      await tick();
      const { checked } = book.verifyMswdWorkbook(buf, result.p, result.report);
      save(buf, `${book.mswdFileName(result.report)}.xlsx`, XLSX_MIME);
      setDone(`Downloaded ${book.mswdFileName(result.report)}.xlsx. All ${n(checked)} numbers on MSWD PERFORMANCE were reopened and match the data.`);
    } catch (e) { setError(`${(e as Error).message} Nothing was downloaded.`); }
    setBusy(null);
  };

  const openWorkspace = () => {
    if (!result) return;
    confirmImport([{ name: 'MASTER DATA', source: 'MSWD performance', headers: result.p.headers, rows: result.p.rows }], { mode: 'single' }, 'MSWD master data');
    onClose();
  };

  const report = result?.report;
  const shown = report ? report.blocks[block < 0 ? report.blocks.length - 1 : block] : null;
  const fixCount = trim ? plan.reduce((s, p) => s + p.fixes.filter((f) => !skip.has(`${p.col}\u0001${f.from}`)).reduce((t, f) => t + f.count, 0), 0) : 0;
  const unused = list.map((s, i) => ({ s, i })).filter(({ i }) => !use[i] && auto[i].reason === 'No Medical Social Worker column' && useOverride[list[i].key] === undefined);
  const listed = list.map((s, i) => ({ s, i })).filter((x) => !unused.includes(x));
  const toggleFix = (key: string) => setSkip((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return (
    <Modal wide title="MSWD performance report" onClose={onClose} footer={result ? <>
      <button className="btn" disabled={Boolean(busy)} onClick={openWorkspace}>Open in workspace <ArrowRight size={15} /></button>
      <button className="btn primary" disabled={Boolean(busy)} onClick={() => void download()}><FileSpreadsheet size={15} /> Download Excel report</button>
    </> : undefined}>
      <div className={`combine-drop ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}>
        <p>Add the NEW and OLD patient responses, one file per month, or an MSWD performance workbook. You get the DASHBOARD, DATA CHECKS, MSWD PERFORMANCE, WORKER REPORT, and MASTER DATA sheets.</p>
        <button className="btn sm" disabled={Boolean(busy)} onClick={() => input.current?.click()}><Plus size={14} /> Add files</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT} aria-label="Choose MSWD files" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {items.length > 0 && (
        <section className="mswd-sources">
          <h3>Sheets used for MASTER DATA</h3>
          <ul>
            {listed.map(({ s, i }) => (
              <li key={s.key} className={use[i] ? 'on' : ''}>
                <label>
                  <input type="checkbox" checked={use[i]} onChange={(e) => setUseOverride((o) => ({ ...o, [s.key]: e.target.checked }))} />
                  <span><b>{s.label}</b><small>{n(s.table.rows.length)} rows · {s.table.headers.length} columns{!use[i] && auto[i].reason ? ` · ${auto[i].reason}` : ''}</small></span>
                </label>
              </li>
            ))}
          </ul>
          {unused.length > 0 && <p className="hint">{unused.length} other {unused.length === 1 ? 'table has' : 'tables have'} no Medical Social Worker column and {unused.length === 1 ? 'is' : 'are'} not used.</p>}
          <div className="mswd-files">{items.map((it, k) => <span key={it.key}>{it.fileName} <button className="icon-btn sm" aria-label={`Remove ${it.fileName}`} onClick={() => change(items.filter((_, j) => j !== k))}><Trash2 size={13} /></button></span>)}</div>
          {stacked.similar.length > 0 && <p className="hint">Matched as the same question: {stacked.similar.map((s) => s.join(' = ')).join('; ')}.</p>}
        </section>
      )}

      {missing.length > 0 && (
        <p className="notice bad"><AlertTriangle size={16} /> {missing.includes('worker') ? 'No Medical Social Worker column was found.' : 'No Month, Timestamp, or Date column was found.'} Choose it under Columns used.</p>
      )}

      {report && result && shown && <>
        <h3 className="mswd-title">{report.title}</h3>
        <dl className="combine-stats">
          <div><dt>Patients catered</dt><dd>{n(report.blocks[report.blocks.length - 1].total.total)}</dd></div>
          <div><dt>RSWs</dt><dd>{report.workers.length}</dd></div>
          <div><dt>Months</dt><dd>{report.months.length}</dd></div>
          <div><dt>Entries corrected</dt><dd>{n(fixCount + result.p.trimmed)}</dd></div>
        </dl>
        <section className="mswd-autofix">
          <label className="switch"><input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /><i /><span>Auto trim and correct</span></label>
          <small>{trim
            ? `Trimmed extra spaces in ${n(result.p.trimmed)} ${result.p.trimmed === 1 ? 'cell' : 'cells'} (names, numbers, addresses, notes) and corrected ${n(fixCount)} ${fixCount === 1 ? 'entry' : 'entries'} in the counted columns. Letters in names and numbers are never changed.`
            : 'Every entry is kept exactly as typed. An entry with a stray space, such as "OP ", is then left out of its column group, as Excel\'s COUNTIFS would do. The checks below list those rows.'}</small>
        </section>

        {comparison && comparison.blocks > 0 && (comparison.mismatches.length === 0
          ? <p className="notice good"><CheckCircle2 size={16} /> The MSWD PERFORMANCE sheet in your file is correct: all {n(comparison.checked)} numbers match its MASTER DATA.</p>
          : <section className="notice warn stack">
              <b>The MSWD PERFORMANCE sheet in your file has {n(comparison.mismatches.length)} {comparison.mismatches.length === 1 ? 'number' : 'numbers'} that do not match its MASTER DATA.</b>
              <ul className="mswd-items">{comparison.mismatches.slice(0, 8).map((m, k) => <li key={k}>{m.block} · {m.name} · {m.column}: sheet shows {m.sheet ?? 'nothing'}, data gives {n(m.computed)}</li>)}</ul>
              <span>The downloaded report uses the numbers from the data.</span>
            </section>)}

        {brief && (
          <section className="analyst open mswd-ai" aria-label="AI summary">
            <header><span className="analyst-badge"><BrainCircuit size={16} /> AI summary</span><h2>{brief.headline}</h2></header>
            <div className="analyst-body">
              {brief.sections.map((s) => (
                <div key={s.heading} className="analyst-list">
                  <h3>{s.heading}</h3>
                  {s.heading === 'Recommended actions'
                    ? <ol>{s.lines.map((l, i) => <li key={i}>{l.replace(/^\d+\.\s*/, '')}</li>)}</ol>
                    : <ul>{s.lines.map((l, i) => <li key={i}><span>{l}</span></li>)}</ul>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mswd-block">
          <div className="mswd-block-head">
            <h3>Most patients catered: top RSW per month</h3>
          </div>
          <div className="mini-table">
            <table>
              <thead><tr><th>Month</th><th>Top RSW</th><th className="num">Patients</th><th className="num">Month total</th></tr></thead>
              <tbody>{report.blocks.map((b, i) => (
                <tr key={i} className={i === (block < 0 ? report.blocks.length - 1 : block) ? 'on' : ''} onClick={() => setBlock(i)}>
                  <td>{b.label === null ? overallLabel(report.months) : `${b.label}${i === report.months.length - 1 && report.months[i]?.partial ? ' (partial)' : ''}`}</td>
                  <td>{b.top.count ? b.top.name : '-'}</td><td className="num">{n(b.top.count)}</td><td className="num">{n(b.total.total)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section className="mswd-block">
          <div className="mswd-block-head">
            <h3>MSWD PERFORMANCE {'—'} {shown.label ?? 'OVERALL TOTAL'}</h3>
            <select aria-label="Month to show" value={block < 0 ? report.blocks.length - 1 : block} onChange={(e) => setBlock(Number(e.target.value))}>
              {report.blocks.map((b, i) => <option key={i} value={i}>{b.label ?? 'Overall total'}</option>)}
            </select>
          </div>
          <div className="mini-table mswd-table">
            <table>
              <thead>
                <tr><th rowSpan={2}>RSW names</th><th rowSpan={2} className="num">Total patient catered</th><th colSpan={4} className="grp t">Type of patient</th><th colSpan={5} className="grp c">Classification</th><th colSpan={5} className="grp m">Misspellings</th><th colSpan={2} className="grp p">Patient type</th><th rowSpan={2} className="num">Rank</th></tr>
                <tr>{[...PATIENT_TYPES, ...CLASSES, 'Brgy', 'Mun', 'Prov', 'Reg', 'Total', 'New', 'Old'].map((h) => <th key={h} className="num">{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.lines.map((l) => (
                  <tr key={l.name} className={l.total > 0 && l.total === shown.top.count ? 'top' : ''}>
                    <td>{l.name}</td>{lineValues(l).map((v, k) => <td key={k} className="num">{n(v)}</td>)}<td className="num">{l.rank}</td>
                  </tr>
                ))}
                <tr className="total"><td>TOTAL</td>{lineValues(shown.total).map((v, k) => <td key={k} className="num">{n(v)}</td>)}<td /></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mswd-checks">
          <h3>Checks</h3>
          <ul>{result.checks.map((c, k) => (
            <li key={k} className={c.level}>
              <CheckIcon level={c.level} />
              <span><b>{c.title}</b>{c.detail && <small>{c.detail}</small>}
                {c.items && c.items.length > 0 && <small className="mswd-items">{c.items.slice(0, 6).map((x) => `${x.label} (${n(x.count)})`).join(' · ')}</small>}
              </span>
            </li>
          ))}</ul>
          {similar.length > 0 && <div className="mswd-merge">{similar.map((w) => (
            <button key={w.name} className="btn sm" onClick={() => setMerges((m) => new Map(m).set(w.name, w.similarTo!))}>Count {w.name} as {w.similarTo}</button>
          ))}</div>}
          {merges.size > 0 && <p className="hint">Counted as another worker: {[...merges].map(([a, b]) => `${a} → ${b}`).join('; ')}. <button className="link" onClick={() => setMerges(new Map())}>Undo</button></p>}
        </section>

        {trim && <details className="mswd-details">
          <summary>Entry corrections ({n(fixCount)} entries in {plan.filter((p) => p.fixes.length).length} columns)</summary>
          <p className="hint">The columns the report counts are corrected: extra spaces, letter case, stray commas, and typing slips such as ILOLO for ILOILO. Untick a correction to keep the entry as it was typed. Every other cell only has its extra spaces trimmed.</p>
          {plan.filter((p) => p.fixes.length).map((p) => {
            const keys = p.fixes.map((f) => `${p.col}\u0001${f.from}`);
            const off = keys.filter((k) => skip.has(k)).length;
            return (
              <div key={p.col} className="mswd-fixes">
                <h4>{p.name} <small>{p.fixes.length} {p.fixes.length === 1 ? 'spelling' : 'spellings'}</small>
                  <button className="link" onClick={() => setSkip((prev) => { const next = new Set(prev); keys.forEach((k) => (off === keys.length ? next.delete(k) : next.add(k))); return next; })}>{off === keys.length ? 'Correct all' : 'Keep all as typed'}</button>
                </h4>
                <ul>{p.fixes.slice(0, 60).map((f) => {
                  const key = `${p.col}\u0001${f.from}`;
                  return (
                    <li key={key}><label><input type="checkbox" checked={!skip.has(key)} onChange={() => toggleFix(key)} />
                      <span><code>{JSON.stringify(f.from).slice(1, -1)}</code> → <code>{f.to}</code> <small>{f.reason} · {n(f.count)}×</small></span></label></li>
                  );
                })}</ul>
                {p.fixes.length > 60 && <p className="hint">and {n(p.fixes.length - 60)} more.</p>}
              </div>
            );
          })}
        </details>}

        <details className="mswd-details">
          <summary>Columns used</summary>
          <div className="mswd-columns">
            {FIELDS.map((f) => (
              <label key={f} className="field compact">{FIELD_LABELS[f]}
                <select value={cols[f] ?? -1} onChange={(e) => setColOverride((o) => ({ ...o, [f]: Number(e.target.value) }))}>
                  <option value={-1}>{result.p.added.includes(FIELD_LABELS[f]) ? 'Added by the app' : 'Not used'}</option>
                  {stacked.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {result.p.added.length > 0 && <p className="hint">Added because the files do not have them: {result.p.added.join(', ')}.</p>}
        </details>

        <fieldset className="combine-options">
          <legend>Workbook</legend>
          <label className="field compact">Department shown on the DASHBOARD <input value={department} onChange={(e) => setDepartment(e.target.value)} /></label>
          <label className="switch"><input type="checkbox" checked={monthSheets} onChange={(e) => setMonthSheets(e.target.checked)} /><i /><span>Add a hidden sheet for each month, as in the original workbook</span></label>
        </fieldset>
      </>}

      {missing.length > 0 && stacked.headers.length > 0 && (
        <div className="mswd-columns">
          {(['worker', 'month', 'timestamp', 'date'] as MswdField[]).map((f) => (
            <label key={f} className="field compact">{FIELD_LABELS[f]}
              <select value={cols[f] ?? -1} onChange={(e) => setColOverride((o) => ({ ...o, [f]: Number(e.target.value) }))}>
                <option value={-1}>Not used</option>
                {stacked.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      <div role="status" aria-live="polite" ref={status}>
        {busy && <p className="notice"><span className="spinner sm" /> {busy}</p>}
        {error && <p className="notice bad">{error}</p>}
        {done && <p className="notice good"><CheckCircle2 size={16} /> {done}</p>}
      </div>
    </Modal>
  );
}
