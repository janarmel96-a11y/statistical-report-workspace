// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bookmark, BrainCircuit, Check, Pause, Play, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Copy, LockKeyhole, Download, Filter, Highlighter, MonitorPlay, Palette, PanelRight, Pencil, Plus, Printer, Redo2, RefreshCw, Search, SlidersHorizontal, Sparkles, Undo2, Volume2, VolumeX, X,
} from 'lucide-react';
import { clonePage, resolveDesign } from '../core/design';
import { formatCell, formatNumber } from '../core/format';
import { newId, recommendTemplates } from '../core/insights';
import { fieldLabel, keyLabel, queryCategories, type Slicer, type Visual } from '../core/report';
import type { Cell, FieldRef } from '../core/types';
import { ACCEPT } from '../ingest';
import { pageConstraints, useStore } from '../state/store';
import { AnalystPanel } from './AnalystPanel';
import { AreaPicker } from './AreaPicker';
import { Logo, Modal, Popover, ThemeSwitch, useDarkMode } from './common';
import { FieldIcon } from './FieldIcon';
import { GUIDE_REVEAL } from './GuideAssistant';
import { NameInput } from './NameInput';
import { ElementCard } from './PageElements';
import { SidePanel, type SideTab } from './SidePanel';
import { canSpeak, speak } from './narrator';
import { slideNarration, StorySlideView, useStoryDeck } from './StoryDeck';
import { VisualCard, type DrillTarget } from './VisualCard';

const Grid = WidthProvider(Responsive);
/** Autoplay time per slide without the voice. */
const SLIDE_MS = 9000;
/** A narrated slide stays at least this long, so short pages do not flash past. */
const MIN_SLIDE_MS = 5000;
const ExportDialog = lazy(() => import('./ExportDialog'));
const VideoStudio = lazy(() => import('./VideoStudio'));

function SlicerControl({ field }: { field: FieldRef }) {
  const engine = useStore((s) => s.engine)!;
  const slicers = useStore((s) => s.slicers);
  const setSlicer = useStore((s) => s.setSlicer);
  const mutateReport = useStore((s) => s.mutateReport);
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const r = queryCategories(engine, field, [{ kind: 'col', col: field.col, agg: 'rows' }], [], { topN: 3000 });
    const col = engine.column(field.col);
    const list = r.categories.filter((c) => !c.isOther);
    return col?.type === 'date' || col?.type === 'number' ? [...list].reverse() : [...list].sort((a, b) => a.label.localeCompare(b.label));
  }, [engine, field]);
  const current = slicers.find((s) => s.col === field.col && s.part === field.part);
  const values = current?.values ?? [];
  const toggle = (k: Cell) => setSlicer({ col: field.col, part: field.part, values: values.includes(k) ? values.filter((x) => x !== k) : [...values, k] });
  const label = field.part ? `${field.col} ${field.part}` : field.col;
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <Popover label={`Filter by ${label}`} button={(open) => (
      <button className={`slicer ${values.length ? 'active' : ''}`} data-guide="slicer" aria-expanded={open}>
        <FieldIcon text={field.col} size={12} /><span>{label}</span><b>{values.length === 0 ? 'All' : values.length === 1 ? keyLabel(engine, field, values[0]) : `${values.length} selected`}</b><ChevronDown size={13} />
      </button>
    )}>
      {() => (
        <div className="slicer-pop">
          {options.length > 8 && <label className="search-box"><Search size={13} /><input aria-label={`Search ${label}`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
          <ul>{shown.map((o) => (
            <li key={String(o.key)}><label><input type="checkbox" checked={values.includes(o.key)} onChange={() => toggle(o.key)} /> <span>{o.label}</span></label></li>
          ))}</ul>
          <footer>
            <button className="link" disabled={!values.length} onClick={() => setSlicer({ col: field.col, part: field.part, values: [] })}>Clear</button>
            <button className="link" onClick={() => { setSlicer({ col: field.col, part: field.part, values: [] }); mutateReport((r) => ({ ...r, slicerFields: r.slicerFields.filter((f) => !(f.col === field.col && f.part === field.part)) })); }}>Remove filter</button>
          </footer>
        </div>
      )}
    </Popover>
  );
}

function FilterBar() {
  const report = useStore((s) => s.report)!;
  const engine = useStore((s) => s.engine)!;
  const slicers = useStore((s) => s.slicers);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const clear = useStore((s) => s.clearFilters);
  const mutateReport = useStore((s) => s.mutateReport);
  const interaction = useStore((s) => s.interaction);
  const setInteraction = useStore((s) => s.setInteraction);
  const rows = engine.rows(pageConstraints(slicers, selection)).length;
  const available = engine.table.columns.filter((c) => (c.type === 'category' || c.type === 'date' || c.type === 'boolean') && !report.slicerFields.some((f) => f.col === c.name));
  return (
    <div className="filterbar" aria-label="Filters">
      <Filter size={15} className="muted" aria-hidden="true" />
      <AreaPicker />
      {report.slicerFields.map((f) => <SlicerControl key={fieldLabel(f)} field={f} />)}
      {available.length > 0 && (
        <Popover label="Add a filter" button={() => <button className="btn sm ghost" data-guide="add-filter"><Plus size={14} /> Filter</button>}>
          {(close) => available.map((c) => <button key={c.name} onClick={() => { mutateReport((r) => ({ ...r, slicerFields: [...r.slicerFields, { col: c.name, part: c.type === 'date' ? 'year' : undefined }] })); close(); }}>{c.name}</button>)}
        </Popover>
      )}
      {selection && <span className="chip sel">{selection.label}<button aria-label="Clear chart selection" onClick={() => setSelection(null)}><X size={12} /></button></span>}
      {(slicers.length > 0 || selection) && <button className="link" onClick={clear}>Clear all</button>}
      <div className="spacer" />
      <span className="rows-count">{rows.toLocaleString()} of {engine.table.rowCount.toLocaleString()} rows</span>
      <div className="segmented text" role="radiogroup" aria-label="When a chart is clicked">
        <button role="radio" aria-checked={interaction === 'filter'} className={interaction === 'filter' ? 'on' : ''} title="Clicking a chart filters the others" onClick={() => setInteraction('filter')}><Filter size={13} /> Filter</button>
        <button role="radio" aria-checked={interaction === 'highlight'} className={interaction === 'highlight' ? 'on' : ''} title="Clicking a chart highlights the others" onClick={() => setInteraction('highlight')}><Highlighter size={13} /> Highlight</button>
      </div>
    </div>
  );
}

function DrillThrough({ target, onClose }: { target: DrillTarget; onClose: () => void }) {
  const engine = useStore((s) => s.engine)!;
  const rows = useMemo(() => engine.rows(target.constraints), [engine, target]);
  const cols = engine.table.columns;
  const measures = cols.filter((c) => c.role === 'measure').slice(0, 4);
  const shown = Array.from(rows.slice(0, 300));
  return (
    <Modal wide title={`Rows behind ${target.label}`} onClose={onClose}>
      <nav className="crumbs big" aria-label="Filter path"><span>{target.title}</span><span>› {target.field.col}: {target.label}</span></nav>
      <div className="drill-kpis">
        <div><small>Rows</small><b>{rows.length.toLocaleString()}</b></div>
        {measures.map((c) => <div key={c.name}><small>Total {c.name}</small><b>{formatNumber(engine.aggregate(rows, c.name, 'sum'), { format: c.format, currency: c.currency })}</b></div>)}
      </div>
      <div className="vt tall" tabIndex={0} aria-label="Matching rows">
        <table>
          <thead><tr>{cols.map((c) => <th key={c.name} className={c.type === 'number' ? 'num' : ''}>{c.name}</th>)}</tr></thead>
          <tbody>{shown.map((r) => <tr key={r}>{cols.map((c) => <td key={c.name} className={c.type === 'number' ? 'num' : ''}>{formatCell(c.values[r], c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {rows.length > 300 && <p className="hint">Showing the first 300 rows. Use Download to get all of them.</p>}
    </Modal>
  );
}

export function Report() {
  const s = useStore();
  const report = s.report!;
  const engine = s.engine!;
  const page = report.pages.find((p) => p.id === s.pageId) ?? report.pages[0];
  const [side, setSide] = useState(() => innerWidth >= 1100);
  const [sideTab, setSideTab] = useState<SideTab>('Fields');
  const [presenting, setPresenting] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dark = useDarkMode();
  const look = useMemo(() => resolveDesign(report.design, dark), [report.design, dark]);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [video, setVideo] = useState(false);
  // The analyst opens by itself on every report. Closing it is remembered for that report only.
  const analystKey = `srw-analyst-hidden:${s.projectId ?? 'new'}`;
  const [analyst, setAnalystState] = useState(() => { try { return localStorage.getItem(analystKey) !== '1'; } catch { return true; } });
  const setAnalyst = (open: boolean) => {
    setAnalystState(open);
    try { if (open) localStorage.removeItem(analystKey); else localStorage.setItem(analystKey, '1'); } catch { /* private mode */ }
  };
  const [renaming, setRenaming] = useState<string | null>(null);
  const [bmName, setBmName] = useState('');
  const replaceInput = useRef<HTMLInputElement>(null);
  const selected = page?.visuals.find((v) => v.id === s.selectedVisual);
  const cs = useMemo(() => pageConstraints(s.slicers, s.selection), [s.slicers, s.selection]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redoReport(); else s.undoReport(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redoReport(); }
      if (e.key === 'Escape') s.setSelection(null);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Present mode: story slides first (title, summary, key figures, forecast, findings), then one report page
   * at a time on the full screen, then the recommended actions. One counter walks through all of them.
   */
  const pageIndex = report.pages.findIndex((p) => p.id === page?.id);
  const deck = useStoryDeck(cs, presenting);
  const [deckPos, setDeckPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const deckTotal = deck.intro.length + report.pages.length + deck.outro.length;
  const stepPage = useCallback((by: number) => {
    setDeckPos((pos) => {
      const st = useStore.getState();
      const pages = st.report?.pages ?? [];
      const next = Math.max(0, Math.min(deck.intro.length + pages.length + deck.outro.length - 1, pos + by));
      const p = pages[next - deck.intro.length];
      if (p && p.id !== st.pageId) st.setPage(p.id);
      return next;
    });
  }, [deck.intro.length, deck.outro.length]);
  const storySlide = !presenting ? null : deckPos < deck.intro.length ? deck.intro[deckPos] : deckPos >= deck.intro.length + report.pages.length ? deck.outro[deckPos - deck.intro.length - report.pages.length] : null;
  // With the voice on, autoplay reads each slide aloud and moves on when it finishes.
  const [voice, setVoiceState] = useState(() => { try { return canSpeak() && localStorage.getItem('srw-present-voice') === 'on'; } catch { return false; } });
  const setVoice = (on: boolean) => { setVoiceState(on); try { localStorage.setItem('srw-present-voice', on ? 'on' : 'off'); } catch { /* private mode */ } };
  const narration = useRef('');
  narration.current = storySlide ? slideNarration(storySlide) : deck.pages[page?.id ?? ''] ?? page?.name ?? '';
  // Autoplay moves to the next slide every 9 seconds, or after the narration, and stops at the end.
  useEffect(() => {
    if (!presenting || !playing) return;
    const last = deckPos >= deckTotal - 1;
    const next = () => { if (last) setPlaying(false); else stepPage(1); };
    if (voice && canSpeak()) {
      const started = Date.now();
      let wait: ReturnType<typeof setTimeout> | undefined;
      const stop = speak(narration.current, () => { wait = setTimeout(next, Math.max(0, MIN_SLIDE_MS - (Date.now() - started))); });
      return () => { stop(); clearTimeout(wait); };
    }
    if (last) { setPlaying(false); return; }
    const t = setTimeout(next, SLIDE_MS);
    return () => clearTimeout(t);
  }, [presenting, playing, deckPos, deckTotal, stepPage, voice]);
  const startPresenting = () => { s.selectVisual(null); setDeckPos(0); setPlaying(false); setPresenting(true); void root.current?.requestFullscreen?.().catch(() => undefined); };
  const stopPresenting = useCallback(() => { setPresenting(false); setPlaying(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); }, []);
  useEffect(() => {
    if (!presenting) return;
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); stepPage(1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); stepPage(-1); }
      if (e.key === 'Escape') stopPresenting();
    };
    let wasFull = false;
    const screen = () => { if (document.fullscreenElement) wasFull = true; else if (wasFull) setPresenting(false); };
    addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', screen);
    return () => { removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', screen); };
  }, [presenting, stepPage, stopPresenting]);
  useEffect(() => { dispatchEvent(new Event('resize')); }, [presenting, side]);

  // The guide can open the assistant in the side panel when it suggests asking a question.
  useEffect(() => {
    const open = (e: Event) => { if ((e as CustomEvent).detail === 'assistant') { setSideTab('Assistant'); setSide(true); } };
    addEventListener(GUIDE_REVEAL, open);
    return () => removeEventListener(GUIDE_REVEAL, open);
  }, []);

  const elements = page?.elements ?? [];
  const layouts = useMemo(() => ({
    lg: page?.layout ?? [],
    sm: [...(page?.visuals ?? []).map((v) => ({ id: v.id, kpi: v.type === 'kpi' })), ...(page?.elements ?? []).map((e) => ({ id: e.id, kpi: false }))].map((v, i) => { const l = page.layout.find((x) => x.i === v.id); return { i: v.id, x: 0, y: i * 10, w: 1, h: v.kpi ? 3 : Math.max(3, l?.h ?? 8) }; }),
  }), [page?.id, page?.layout, page?.visuals, page?.elements]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLayout = useCallback((current: Layout[]) => {
    if (innerWidth < 760) return;
    const st = useStore.getState();
    const pg = st.report?.pages.find((p) => p.id === st.pageId);
    if (!pg) return;
    const next = current.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    const same = next.every((n) => { const o = pg.layout.find((l) => l.i === n.i); return o && o.x === n.x && o.y === n.y && o.w === n.w && o.h === n.h; });
    if (!same) st.mutatePage((p) => ({ ...p, layout: next }), false);
  }, []);

  const addVisual = () => {
    const metric = engine.table.columns.find((c) => c.role === 'measure');
    const dim = engine.table.columns.find((c) => c.type === 'category');
    const v: Visual = { id: newId(), type: 'column', title: 'New chart', axis: dim ? [{ col: dim.name }] : [], values: metric ? [{ kind: 'col', col: metric.name, agg: 'sum' }] : [], tooltips: [] };
    s.mutatePage((p) => ({ ...p, visuals: [...p.visuals, v], layout: [...p.layout, { i: v.id, x: 0, y: 9999, w: 6, h: 8 }] }));
    s.selectVisual(v.id);
    setSide(true);
  };

  if (!page) return null;
  const templates = recommendTemplates(engine);
  const brand = look.design;
  const movePage = (by: number) => s.mutateReport((r) => { const next = [...r.pages]; const j = pageIndex + by; [next[pageIndex], next[j]] = [next[j], next[pageIndex]]; return { ...r, pages: next }; });
  const copyPage = () => { const copy = clonePage(page, () => newId('c')); s.mutateReport((r) => { const next = [...r.pages]; next.splice(pageIndex + 1, 0, copy); return { ...r, pages: next }; }); s.setPage(copy.id); };
  return (
    <div ref={root} className={`report ${look.className} ${presenting ? 'presenting' : ''}`} style={look.vars as CSSProperties}>
      <header className="topbar no-print">
        <button className="icon-btn" data-guide="home" aria-label="Back to home" title="Back to home" onClick={() => s.setRoute('home')}><ArrowLeft size={18} /></button>
        <Logo />
        <NameInput className="title-input" label="Report name" value={report.title} onCommit={s.renameProject} />
        <div className="spacer" />
        <button className="icon-btn" aria-label="Undo" title="Undo" disabled={!s.undoStack.length} onClick={s.undoReport}><Undo2 size={17} /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo" disabled={!s.redoStack.length} onClick={s.redoReport}><Redo2 size={17} /></button>
        {s.accessRole !== 'viewer' && <button className="btn ghost" data-guide="data" onClick={() => s.setRoute('prepare')}><SlidersHorizontal size={15} /> Data</button>}
        {s.accessRole !== 'viewer' && <button className="btn ghost" title="Replace the data and keep this report" onClick={() => replaceInput.current?.click()}><RefreshCw size={15} /> Refresh</button>}
        <input ref={replaceInput} type="file" hidden accept={ACCEPT} aria-label="Choose a new data file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.replaceData(f); e.target.value = ''; }} />
        <Popover label="Bookmarks" align="right" button={() => <button className="icon-btn" aria-label="Bookmarks" title="Bookmarks"><Bookmark size={17} /></button>}>
          {(close) => (
            <div className="bm">
              {report.bookmarks.map((b) => (
                <div className="bm-row" key={b.name}>
                  <button onClick={() => { s.applyBookmark(b); close(); }}>{b.name}</button>
                  <button className="icon-btn sm" aria-label={`Delete ${b.name}`} onClick={() => s.mutateReport((r) => ({ ...r, bookmarks: r.bookmarks.filter((x) => x.name !== b.name) }))}><X size={13} /></button>
                </div>
              ))}
              <div className="row-gap">
                <input aria-label="Bookmark name" placeholder="Name this view" value={bmName} onChange={(e) => setBmName(e.target.value)} />
                <button className="btn sm" disabled={!bmName.trim()} onClick={() => { s.mutateReport((r) => ({ ...r, bookmarks: [...r.bookmarks.filter((b) => b.name !== bmName.trim()), { name: bmName.trim(), pageId: page.id, slicers: s.slicers as Slicer[], selection: s.selection }] })); setBmName(''); }}>Save</button>
              </div>
            </div>
          )}
        </Popover>
        <button className="icon-btn" aria-label="Print" title="Print" onClick={() => print()}><Printer size={17} /></button>
        <ThemeSwitch />
        <button className="icon-btn" aria-label="Toggle side panel" aria-pressed={side} title="Toggle side panel" onClick={() => setSide(!side)}><PanelRight size={17} /></button>
        {s.accessRole !== 'viewer' && <button className={`btn ghost ${side && sideTab === 'Design' ? 'active' : ''}`} data-guide="design" onClick={() => { setSideTab('Design'); setSide(true); }}><Palette size={15} /> Design</button>}
        <button className={`btn ghost ${analyst ? 'active' : ''}`} data-guide="analyst" aria-pressed={analyst} onClick={() => setAnalyst(!analyst)}><BrainCircuit size={15} /> Analyst</button>
        <button className="btn ghost" data-guide="present" onClick={startPresenting}><MonitorPlay size={15} /> Present</button>
        <button className="btn ghost" data-guide="video" onClick={() => setVideo(true)}><Clapperboard size={15} /> Video</button>
        <button className="btn primary" data-guide="download" onClick={() => setExporting(true)}><Download size={15} /> Download</button>
      </header>

      {s.schemaNotice && (
        <div className="banner" role="alert">
          <AlertTriangle size={16} />
          <span>The new file has a different structure.
            {s.schemaNotice.missing.length > 0 && ` Missing: ${s.schemaNotice.missing.join(', ')}.`}
            {s.schemaNotice.added.length > 0 && ` New: ${s.schemaNotice.added.join(', ')}.`}
            {s.schemaNotice.typeChanged.length > 0 && ` Changed type: ${s.schemaNotice.typeChanged.join(', ')}.`}
            {' '}Charts that used missing fields need to be updated.</span>
          <button className="icon-btn sm" aria-label="Dismiss" onClick={s.dismissSchemaNotice}><X size={14} /></button>
        </div>
      )}

      {s.accessRole === 'viewer' && <div className="banner info" role="status"><LockKeyhole size={16} /><span><b>Viewer access.</b> Personal and identifying columns are not included in this copy.</span></div>}
      {s.autoNotice && (
        <div className="banner info" role="status">
          <Sparkles size={16} />
          <span>
            <b>Report generated automatically</b> from {s.autoNotice.used} ({s.autoNotice.rows.toLocaleString()} rows).
            {' '}{[
              s.autoNotice.corrected > 0 && `${s.autoNotice.corrected.toLocaleString()} ${s.autoNotice.corrected === 1 ? 'value' : 'values'} corrected`,
              s.autoNotice.removedRows > 0 && `${s.autoNotice.removedRows.toLocaleString()} ${s.autoNotice.removedRows === 1 ? 'row' : 'rows'} removed`,
              s.autoNotice.labelsFixed > 0 && `${s.autoNotice.labelsFixed.toLocaleString()} ${s.autoNotice.labelsFixed === 1 ? 'label' : 'labels'} fixed`,
            ].filter(Boolean).join(', ') || 'No corrections were needed'}.
            {s.autoNotice.review > 0 && ` ${s.autoNotice.review} ${s.autoNotice.review === 1 ? 'item needs' : 'items need'} your review.`}
            {s.autoNotice.skipped.length > 0 && ` Not used: ${s.autoNotice.skipped.join(', ')}.`}
            {s.autoNotice.repeated.length > 0 && ` Left out so no row is counted twice: ${s.autoNotice.repeated.join('; ')}.`}
            {s.autoNotice.note && ` ${s.autoNotice.note}`}
          </span>
          <button className="btn sm" onClick={() => { s.dismissAutoNotice(); s.setRoute('prepare'); }}>Review data</button>
          <button className="icon-btn sm" aria-label="Dismiss" onClick={s.dismissAutoNotice}><X size={14} /></button>
        </div>
      )}

      <div className="report-body">
        <main className="canvas">
          {(brand.logo || brand.organization || presenting) && (
            <header className="report-brand">
              {brand.logo && <img src={brand.logo} alt={brand.organization ? `${brand.organization} logo` : 'Organization logo'} />}
              <div>{brand.organization && <small>{brand.organization}</small>}{presenting && <h1>{report.title}<span> · {page.name}</span></h1>}</div>
            </header>
          )}
          {analyst && !presenting && <AnalystPanel cs={cs} onClose={() => setAnalyst(false)} />}
          <nav className="pages no-print" aria-label="Report pages">
            {report.pages.map((p) => (
              renaming === p.id ? (
                <input key={p.id} autoFocus aria-label="Page name" defaultValue={p.name} onBlur={(e) => { const name = e.target.value.trim() || p.name; s.mutateReport((r) => ({ ...r, pages: r.pages.map((x) => (x.id === p.id ? { ...x, name } : x)) })); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              ) : (
                <button key={p.id} className={p.id === page.id ? 'on' : ''} aria-current={p.id === page.id ? 'page' : undefined} onClick={() => s.setPage(p.id)} onDoubleClick={() => setRenaming(p.id)}>
                  {p.name}{p.id === page.id && <Pencil size={11} className="pg-edit" onClick={(e) => { e.stopPropagation(); setRenaming(p.id); }} aria-label="Rename page" />}
                </button>
              )
            ))}
            <Popover label="Add a page" button={() => <button className="add-page" data-guide="add-page" aria-label="Add a page"><Plus size={15} /></button>}>
              {(close) => <>
                {templates.map((t) => <button key={t.id} className="tpl" onClick={() => { s.addTemplatePage(t.id); close(); }}><b>{t.name}</b><small>{t.reason}. {t.description}</small></button>)}
                <button className="tpl" onClick={() => { const id = newId('p'); s.mutateReport((r) => ({ ...r, pages: [...r.pages, { id, name: `Page ${r.pages.length + 1}`, visuals: [], layout: [] }] })); s.setPage(id); close(); }}><b>Blank page</b></button>
              </>}
            </Popover>
            <div className="spacer" />
            <button className="icon-btn sm" aria-label="Move page left" title="Move page left" disabled={pageIndex <= 0} onClick={() => movePage(-1)}><ChevronLeft size={15} /></button>
            <button className="icon-btn sm" aria-label="Move page right" title="Move page right" disabled={pageIndex >= report.pages.length - 1} onClick={() => movePage(1)}><ChevronRight size={15} /></button>
            <button className="icon-btn sm" aria-label="Duplicate page" title="Duplicate page" onClick={copyPage}><Copy size={14} /></button>
            {report.pages.length > 1 && <button className="link" onClick={() => { const rest = report.pages.filter((p) => p.id !== page.id); s.mutateReport((r) => ({ ...r, pages: rest })); s.setPage(rest[0].id); }}>Delete page</button>}
            <button className="btn sm" onClick={addVisual}><Plus size={14} /> Add visual</button>
          </nav>
          <FilterBar />
          {page.visuals.length === 0 && elements.length === 0 ? (
            <div className="blank-page"><Check size={20} /><p>This page is empty.</p><button className="btn primary" onClick={addVisual}><Plus size={15} /> Add a visual</button></div>
          ) : (
            <Grid key={page.id} className="bento" layouts={layouts} breakpoints={{ lg: 760, sm: 0 }} cols={{ lg: 12, sm: 1 }} rowHeight={26} margin={[12, 12]} containerPadding={[0, 0]}
              draggableHandle=".card-drag" draggableCancel=".card-tools,button,select,input" onLayoutChange={onLayout} measureBeforeMount={false} useCSSTransforms isDraggable={!presenting} isResizable={!presenting}>
              {page.visuals.map((v) => <div key={v.id}><VisualCard visual={v} onDrillThrough={setDrill} /></div>)}
              {elements.map((e) => <div key={e.id} onMouseDown={() => { if (!presenting) { setSideTab('Design'); setSide(true); } }}><ElementCard el={e} /></div>)}
            </Grid>
          )}
        </main>
        {side && !presenting && <SidePanel visual={selected} cs={cs} tab={sideTab} onTab={setSideTab} onClose={() => setSide(false)} />}
      </div>
      {storySlide && <div className="story-stage"><StorySlideView key={deckPos} slide={storySlide} index={deckPos} /></div>}
      {presenting && (
        <nav className="present-bar" aria-label="Presentation controls">
          <span className="present-progress" aria-hidden="true"><i style={{ width: `${((deckPos + 1) / Math.max(1, deckTotal)) * 100}%` }} /></span>
          <button className="icon-btn" aria-label="Previous slide" disabled={deckPos <= 0} onClick={() => stepPage(-1)}><ArrowLeft size={17} /></button>
          <span role="status">{deckPos + 1} / {deckTotal}</span>
          <button className="icon-btn" aria-label="Next slide" disabled={deckPos >= deckTotal - 1} onClick={() => stepPage(1)}><ArrowRight size={17} /></button>
          <button className="icon-btn" aria-label={playing ? 'Pause autoplay' : 'Play automatically'} aria-pressed={playing} title={playing ? 'Pause' : 'Play automatically'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          {canSpeak() && <button className={`icon-btn ${voice ? 'on' : ''}`} aria-label={voice ? 'Turn the voice off' : 'Read the slides aloud'} aria-pressed={voice} title={voice ? 'Voice on' : 'Read the slides aloud'} onClick={() => setVoice(!voice)}>{voice ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>}
          {playing && voice && <span className="present-speaking" aria-label="Narrating" role="img"><i /><i /><i /><i /></span>}
          {playing && !voice && deckPos < deckTotal - 1 && <span className="present-timer" key={deckPos} aria-hidden="true"><i style={{ animationDuration: `${SLIDE_MS}ms` }} /></span>}
          <button className="btn sm" onClick={stopPresenting}><X size={14} /> Exit</button>
        </nav>
      )}
      {drill && <DrillThrough target={drill} onClose={() => setDrill(null)} />}
      {video && <Suspense fallback={null}><VideoStudio onClose={() => setVideo(false)} /></Suspense>}
      {exporting && <Suspense fallback={null}><ExportDialog onClose={() => setExporting(false)} onVideo={() => { setExporting(false); setVideo(true); }} /></Suspense>}
    </div>
  );
}
