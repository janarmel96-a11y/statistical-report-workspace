import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import {
  AlertTriangle, ArrowLeft, Bookmark, Check, ChevronDown, Download, Filter, Highlighter, PanelRight, Pencil, Plus, Printer, Redo2, RefreshCw, Search, SlidersHorizontal, Undo2, X,
} from 'lucide-react';
import { formatCell, formatNumber } from '../core/format';
import { newId, recommendTemplates } from '../core/insights';
import { fieldLabel, keyLabel, queryCategories, type Slicer, type Visual } from '../core/report';
import type { Cell, FieldRef } from '../core/types';
import { ACCEPT } from '../ingest';
import { pageConstraints, useStore } from '../state/store';
import { Logo, Modal, Popover, ThemeSwitch } from './common';
import { SidePanel } from './SidePanel';
import { VisualCard, type DrillTarget } from './VisualCard';

const Grid = WidthProvider(Responsive);
const ExportDialog = lazy(() => import('./ExportDialog'));

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
      <button className={`slicer ${values.length ? 'active' : ''}`} aria-expanded={open}>
        <span>{label}</span><b>{values.length === 0 ? 'All' : values.length === 1 ? keyLabel(engine, field, values[0]) : `${values.length} selected`}</b><ChevronDown size={13} />
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
      {report.slicerFields.map((f) => <SlicerControl key={fieldLabel(f)} field={f} />)}
      {available.length > 0 && (
        <Popover label="Add a filter" button={() => <button className="btn sm ghost"><Plus size={14} /> Filter</button>}>
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
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [exporting, setExporting] = useState(false);
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

  const layouts = useMemo(() => ({
    lg: page?.layout ?? [],
    sm: (page?.visuals ?? []).map((v, i) => { const l = page.layout.find((x) => x.i === v.id); return { i: v.id, x: 0, y: i * 10, w: 1, h: v.type === 'kpi' ? 3 : Math.max(8, l?.h ?? 8) }; }),
  }), [page?.id, page?.layout, page?.visuals]); // eslint-disable-line react-hooks/exhaustive-deps

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
  return (
    <div className="report">
      <header className="topbar no-print">
        <button className="icon-btn" aria-label="Back to home" title="Back to home" onClick={() => s.setRoute('home')}><ArrowLeft size={18} /></button>
        <Logo />
        <input className="title-input" aria-label="Report title" value={report.title} onChange={(e) => s.mutateReport((r) => ({ ...r, title: e.target.value }), false)} />
        <div className="spacer" />
        <button className="icon-btn" aria-label="Undo" title="Undo" disabled={!s.undoStack.length} onClick={s.undoReport}><Undo2 size={17} /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo" disabled={!s.redoStack.length} onClick={s.redoReport}><Redo2 size={17} /></button>
        <button className="btn ghost" onClick={() => s.setRoute('prepare')}><SlidersHorizontal size={15} /> Data</button>
        <button className="btn ghost" title="Replace the data and keep this report" onClick={() => replaceInput.current?.click()}><RefreshCw size={15} /> Refresh</button>
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
        <select className="palette" aria-label="Chart colors" value={`${s.palette}${s.patterns ? '+p' : ''}`} onChange={(e) => { const [p, q] = e.target.value.split('+'); s.setPalette(p as 'standard' | 'bright'); s.setPatterns(q === 'p'); }}>
          <option value="standard">Colors: Standard</option><option value="bright">Colors: Warm first</option><option value="standard+p">Colors: With patterns</option>
        </select>
        <ThemeSwitch />
        <button className="icon-btn" aria-label="Toggle side panel" aria-pressed={side} title="Toggle side panel" onClick={() => setSide(!side)}><PanelRight size={17} /></button>
        <button className="btn primary" onClick={() => setExporting(true)}><Download size={15} /> Download</button>
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

      <div className="report-body">
        <main className="canvas">
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
            <Popover label="Add a page" button={() => <button className="add-page" aria-label="Add a page"><Plus size={15} /></button>}>
              {(close) => <>
                {templates.map((t) => <button key={t.id} className="tpl" onClick={() => { s.addTemplatePage(t.id); close(); }}><b>{t.name}</b><small>{t.reason}. {t.description}</small></button>)}
                <button className="tpl" onClick={() => { const id = newId('p'); s.mutateReport((r) => ({ ...r, pages: [...r.pages, { id, name: `Page ${r.pages.length + 1}`, visuals: [], layout: [] }] })); s.setPage(id); close(); }}><b>Blank page</b></button>
              </>}
            </Popover>
            <div className="spacer" />
            {report.pages.length > 1 && <button className="link" onClick={() => { const rest = report.pages.filter((p) => p.id !== page.id); s.mutateReport((r) => ({ ...r, pages: rest })); s.setPage(rest[0].id); }}>Delete page</button>}
            <button className="btn sm" onClick={addVisual}><Plus size={14} /> Add visual</button>
          </nav>
          <FilterBar />
          {page.visuals.length === 0 ? (
            <div className="blank-page"><Check size={20} /><p>This page is empty.</p><button className="btn primary" onClick={addVisual}><Plus size={15} /> Add a visual</button></div>
          ) : (
            <Grid key={page.id} className="bento" layouts={layouts} breakpoints={{ lg: 760, sm: 0 }} cols={{ lg: 12, sm: 1 }} rowHeight={26} margin={[12, 12]} containerPadding={[0, 0]}
              draggableHandle=".card-drag" draggableCancel=".card-tools,button,select,input" onLayoutChange={onLayout} measureBeforeMount={false} useCSSTransforms>
              {page.visuals.map((v) => <div key={v.id}><VisualCard visual={v} onDrillThrough={setDrill} /></div>)}
            </Grid>
          )}
        </main>
        {side && <SidePanel visual={selected} cs={cs} onClose={() => setSide(false)} />}
      </div>
      {drill && <DrillThrough target={drill} onClose={() => setDrill(null)} />}
      {exporting && <Suspense fallback={null}><ExportDialog onClose={() => setExporting(false)} /></Suspense>}
    </div>
  );
}
