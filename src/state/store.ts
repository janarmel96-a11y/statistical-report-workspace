import { create } from 'zustand';
import { qualityScore, runAudit, type QualityScore } from '../core/audit';
import { Engine } from '../core/engine';
import { generateInsights, newId, newReport, recommendTemplates } from '../core/insights';
import { inferTable, type InferredColumn } from '../core/parse';
import { appendTables, applyRecipe, diffSchema, joinTables, reusableSteps, type SchemaDiff } from '../core/recipe';
import type { Bookmark, Page, ReportDoc, Selection, Slicer, Visual } from '../core/report';
import { DEFAULT_LOCALE, type Constraint, type DataTable, type Finding, type LocaleOptions, type RawTable, type Step } from '../core/types';
import { readFile } from '../ingest';
import { saveProject, type CombineConfig, type ProjectRecord } from './persist';

export type Route = 'home' | 'prepare' | 'report';
export type ThemeMode = 'system' | 'light' | 'dark';
export type PaletteName = 'standard' | 'bright';

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

interface State {
  route: Route;
  themeMode: ThemeMode;
  palette: PaletteName;
  patterns: boolean;
  busy: { message: string; fraction?: number } | null;
  toasts: Toast[];
  pending: RawTable[] | null;

  projectId: string | null;
  projectName: string;
  raws: RawTable[];
  combine: CombineConfig;
  locale: LocaleOptions;
  base: DataTable | null;
  inferred: InferredColumn[];
  findings: Finding[];
  quality: QualityScore | null;
  disabled: string[];
  steps: Step[];
  redoSteps: Step[];
  table: DataTable | null;

  engine: Engine | null;
  report: ReportDoc | null;
  pageId: string | null;
  selectedVisual: string | null;
  slicers: Slicer[];
  selection: Selection | null;
  interaction: 'filter' | 'highlight';
  undoStack: ReportDoc[];
  redoStack: ReportDoc[];
  schemaNotice: SchemaDiff | null;
  revision: number;

  setRoute(r: Route): void;
  setTheme(m: ThemeMode): void;
  setPalette(p: PaletteName): void;
  setPatterns(v: boolean): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  importFiles(files: File[]): Promise<void>;
  loadSample(url: string, name: string): Promise<void>;
  cancelImport(): void;
  confirmImport(tables: RawTable[], combine: CombineConfig): void;
  openRecord(p: ProjectRecord): void;
  setLocale(l: LocaleOptions): void;
  addStep(s: Step): void;
  undoStep(): void;
  redoStep(): void;
  toggleFinding(id: string): void;
  buildReport(): void;
  replaceData(file: File): Promise<void>;

  mutateReport(fn: (r: ReportDoc) => ReportDoc, history?: boolean): void;
  mutatePage(fn: (p: Page) => Page, history?: boolean): void;
  mutateVisual(id: string, fn: (v: Visual) => Visual, history?: boolean): void;
  undoReport(): void;
  redoReport(): void;
  setPage(id: string): void;
  selectVisual(id: string | null): void;
  setSlicer(s: Slicer): void;
  clearFilters(): void;
  setSelection(s: Selection | null): void;
  setInteraction(m: 'filter' | 'highlight'): void;
  applyBookmark(b: Bookmark): void;
  addTemplatePage(id: string): void;
  dismissSchemaNotice(): void;
}

function readPref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

export function buildBase(raws: RawTable[], combine: CombineConfig, locale: LocaleOptions) {
  const parts = raws.map((r) => inferTable(r, locale));
  let table = parts[0].table;
  if (combine.mode === 'append') table = appendTables(parts.map((p) => p.table), raws.map((r) => r.name).join(' + '));
  if (combine.mode === 'join' && combine.leftKey && combine.rightKey) {
    for (const p of parts.slice(1)) table = joinTables(table, p.table, combine.leftKey, combine.rightKey).table;
  }
  const inferred = combine.mode === 'append' ? parts.flatMap((p) => p.inferred) : combine.mode === 'join' ? parts.flatMap((p) => p.inferred) : parts[0].inferred;
  return { table, inferred };
}

let toastId = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => {
  const clean = (base: DataTable, findings: Finding[], disabled: string[], steps: Step[]) =>
    applyRecipe(base, [...findings.filter((f) => !disabled.includes(f.id)).flatMap((f) => f.steps), ...steps]);

  const refreshTable = () => {
    const s = get();
    if (s.base) set({ table: clean(s.base, s.findings, s.disabled, s.steps) });
    persist();
  };

  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const s = get();
      if (!s.projectId || !s.table) return;
      void saveProject({
        id: s.projectId, name: s.report?.title ?? s.projectName, updatedAt: Date.now(), rowCount: s.table.rowCount, columnCount: s.table.columns.length,
        raws: s.raws, combine: s.combine, locale: s.locale, steps: s.steps, disabledFindings: s.disabled, report: s.report,
      });
    }, 500);
  };

  const startProject = (raws: RawTable[], combine: CombineConfig, opts: Partial<ProjectRecord> = {}) => {
    const locale = opts.locale ?? DEFAULT_LOCALE;
    const { table, inferred } = buildBase(raws, combine, locale);
    const findings = runAudit(table, inferred);
    const disabled = (opts.disabledFindings ?? findings.filter((f) => !f.auto).map((f) => f.id));
    const steps = opts.steps ?? [];
    const cleanTable = clean(table, findings, disabled, steps);
    set({
      projectId: opts.id ?? newId('r'), projectName: opts.name ?? table.name, raws, combine, locale, base: table, inferred, findings,
      quality: qualityScore(table, findings), disabled, steps, redoSteps: [], table: cleanTable, pending: null,
      report: opts.report ?? null, engine: null, slicers: [], selection: null, selectedVisual: null, undoStack: [], redoStack: [], schemaNotice: null,
    });
  };

  const syncEngine = (r: ReportDoc | null) => {
    const { engine } = get();
    if (engine && r) { engine.setMeasures(r.measures); engine.setParams(r.parameters); }
  };

  return {
    route: 'home',
    themeMode: readPref<ThemeMode>('srw-theme', 'system'),
    palette: readPref<PaletteName>('srw-palette', 'standard'),
    patterns: readPref<string>('srw-patterns', 'off') === 'on',
    busy: null, toasts: [], pending: null,
    projectId: null, projectName: '', raws: [], combine: { mode: 'single' }, locale: DEFAULT_LOCALE,
    base: null, inferred: [], findings: [], quality: null, disabled: [], steps: [], redoSteps: [], table: null,
    engine: null, report: null, pageId: null, selectedVisual: null, slicers: [], selection: null, interaction: 'filter',
    undoStack: [], redoStack: [], schemaNotice: null, revision: 0,

    setRoute: (route) => { set({ route }); if (location.hash !== `#/${route === 'home' ? '' : route}`) location.hash = `/${route === 'home' ? '' : route}`; },
    setTheme: (themeMode) => { writePref('srw-theme', themeMode); set({ themeMode }); },
    setPalette: (palette) => { writePref('srw-palette', palette); set({ palette }); },
    setPatterns: (patterns) => { writePref('srw-patterns', patterns ? 'on' : 'off'); set({ patterns }); },
    toast: (kind, text) => {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    importFiles: async (files) => {
      const found: RawTable[] = [];
      for (const f of files) {
        try {
          set({ busy: { message: `Reading ${f.name}` } });
          if (/\.statreport\.json$/i.test(f.name)) {
            const p = JSON.parse(await f.text()) as Partial<ProjectRecord> & { app?: string };
            if (p.app !== 'statistical-report-workspace' || !p.raws?.length || !p.report) throw new Error(`${f.name} is not a valid report project.`);
            set({ busy: null });
            get().openRecord({ id: newId('r'), name: p.report.title, updatedAt: Date.now(), rowCount: 0, columnCount: 0, raws: p.raws, combine: p.combine ?? { mode: 'single' }, locale: p.locale ?? DEFAULT_LOCALE, steps: p.steps ?? [], disabledFindings: p.disabledFindings ?? [], report: p.report });
            return;
          }
          found.push(...await readFile(f, (message, fraction) => set({ busy: { message, fraction } })));
        } catch (e) {
          get().toast('error', (e as Error).message);
        }
      }
      set({ busy: null });
      if (!found.length) return;
      if (found.length === 1 && !found[0].confidence) { get().confirmImport(found, { mode: 'single' }); return; }
      set({ pending: found });
    },
    loadSample: async (url, name) => {
      set({ busy: { message: `Loading ${name}` } });
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Sample not found');
        await get().importFiles([new File([await res.blob()], name)]);
      } catch {
        get().toast('error', 'The sample could not be loaded.');
      }
      set({ busy: null });
    },
    cancelImport: () => set({ pending: null }),
    confirmImport: (tables, combine) => {
      startProject(tables, combine);
      get().setRoute('prepare');
      persist();
    },
    openRecord: (p) => {
      startProject(p.raws, p.combine, p);
      if (p.report) get().buildReport(); else get().setRoute('prepare');
    },
    setLocale: (locale) => {
      const s = get();
      if (!s.raws.length) return;
      startProject(s.raws, s.combine, { id: s.projectId ?? undefined, name: s.projectName, locale, steps: s.steps, report: s.report });
      persist();
    },
    addStep: (step) => { set((s) => ({ steps: [...s.steps, step], redoSteps: [] })); refreshTable(); },
    undoStep: () => {
      const { steps, redoSteps } = get();
      if (!steps.length) return;
      set({ steps: steps.slice(0, -1), redoSteps: [...redoSteps, steps[steps.length - 1]] });
      refreshTable();
    },
    redoStep: () => {
      const { steps, redoSteps } = get();
      if (!redoSteps.length) return;
      set({ steps: [...steps, redoSteps[redoSteps.length - 1]], redoSteps: redoSteps.slice(0, -1) });
      refreshTable();
    },
    toggleFinding: (id) => {
      set((s) => ({ disabled: s.disabled.includes(id) ? s.disabled.filter((d) => d !== id) : [...s.disabled, id] }));
      refreshTable();
    },

    buildReport: () => {
      const s = get();
      if (!s.table) return;
      const measures = s.report?.measures ?? [];
      const engine = new Engine(s.table, measures, s.report?.parameters ?? []);
      let report = s.report;
      if (report) {
        // Keep the existing report. Remove only references to columns that no longer exist.
        const has = (c: string) => Boolean(engine.column(c));
        const fixVisual = (v: Visual): Visual => ({
          ...v,
          axis: v.axis.filter((f) => has(f.col)),
          legend: v.legend && has(v.legend.col) ? v.legend : undefined,
          multiples: v.multiples && has(v.multiples.col) ? v.multiples : undefined,
          values: v.values.filter((x) => x.kind === 'measure' || x.agg === 'rows' || has(x.col)),
          tooltips: v.tooltips.filter((x) => x.kind === 'measure' || has(x.col)),
          drillPath: (v.drillPath ?? []).filter((d) => has(d.field.col)),
        });
        report = { ...report, slicerFields: report.slicerFields.filter((f) => has(f.col)), pages: report.pages.map((p) => ({ ...p, visuals: p.visuals.map(fixVisual) })) };
      } else {
        report = newReport(engine, s.projectName || 'Report');
      }
      set({ engine, report, pageId: report.pages.find((p) => p.id === s.pageId)?.id ?? report.pages[0]?.id ?? null, slicers: [], selection: null, revision: s.revision + 1 });
      get().setRoute('report');
      persist();
    },
    replaceData: async (file) => {
      const s = get();
      set({ busy: { message: `Reading ${file.name}` } });
      try {
        const tables = await readFile(file, (message, fraction) => set({ busy: { message, fraction } }));
        const prev = s.table!;
        const { table, inferred } = buildBase([tables[0]], { mode: 'single' }, s.locale);
        const findings = runAudit(table, inferred);
        const disabled = findings.filter((f) => !f.auto).map((f) => f.id);
        const steps = reusableSteps(s.steps);
        const next = clean(table, findings, disabled, steps);
        const diff = diffSchema(prev, next);
        set({ raws: [tables[0]], combine: { mode: 'single' }, base: table, inferred, findings, quality: qualityScore(table, findings), disabled, steps, redoSteps: [], table: next });
        get().buildReport();
        set({ schemaNotice: diff.missing.length || diff.added.length || diff.typeChanged.length ? diff : null });
        get().toast('success', `Report refreshed with ${next.rowCount.toLocaleString()} rows from ${file.name}.`);
      } catch (e) {
        get().toast('error', (e as Error).message);
      }
      set({ busy: null });
    },

    mutateReport: (fn, history = true) => {
      const { report, undoStack } = get();
      if (!report) return;
      const next = fn(report);
      syncEngine(next);
      set((s) => ({ report: next, undoStack: history ? [...undoStack.slice(-49), report] : undoStack, redoStack: history ? [] : s.redoStack, revision: s.revision + 1 }));
      persist();
    },
    mutatePage: (fn, history = true) => {
      const { pageId } = get();
      get().mutateReport((r) => ({ ...r, pages: r.pages.map((p) => (p.id === pageId ? fn(p) : p)) }), history);
    },
    mutateVisual: (id, fn, history = true) => get().mutatePage((p) => ({ ...p, visuals: p.visuals.map((v) => (v.id === id ? fn(v) : v)) }), history),
    undoReport: () => {
      const { undoStack, redoStack, report } = get();
      if (!undoStack.length || !report) return;
      const prev = undoStack[undoStack.length - 1];
      syncEngine(prev);
      set((s) => ({ report: prev, undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, report], revision: s.revision + 1 }));
      persist();
    },
    redoReport: () => {
      const { undoStack, redoStack, report } = get();
      if (!redoStack.length || !report) return;
      const next = redoStack[redoStack.length - 1];
      syncEngine(next);
      set((s) => ({ report: next, redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, report], revision: s.revision + 1 }));
      persist();
    },
    setPage: (pageId) => set({ pageId, selectedVisual: null, selection: null }),
    selectVisual: (selectedVisual) => set({ selectedVisual }),
    setSlicer: (sl) => set((s) => {
      const rest = s.slicers.filter((x) => !(x.col === sl.col && x.part === sl.part));
      return { slicers: sl.values.length ? [...rest, sl] : rest, revision: s.revision + 1 };
    }),
    clearFilters: () => set((s) => ({ slicers: [], selection: null, revision: s.revision + 1 })),
    setSelection: (selection) => set((s) => ({ selection, revision: s.revision + 1 })),
    setInteraction: (interaction) => set((s) => ({ interaction, revision: s.revision + 1 })),
    applyBookmark: (b) => set((s) => ({ pageId: b.pageId, slicers: b.slicers, selection: b.selection, revision: s.revision + 1 })),
    addTemplatePage: (id) => {
      const { engine } = get();
      if (!engine) return;
      const t = recommendTemplates(engine).find((x) => x.id === id);
      if (!t) return;
      const page = t.build();
      get().mutateReport((r) => ({ ...r, pages: [...r.pages, page] }));
      set({ pageId: page.id });
    },
    dismissSchemaNotice: () => set({ schemaNotice: null }),
  };
});

/** Page-level filters as constraints. `forVisual` skips that visual's own selection. */
export function pageConstraints(slicers: Slicer[], selection: Selection | null, forVisual?: string, interaction: 'filter' | 'highlight' = 'filter'): Constraint[] {
  const cs: Constraint[] = slicers.map((s) => ({ col: s.col, kind: 'in', part: s.part, values: s.values }));
  if (selection && selection.visualId !== forVisual && interaction === 'filter') {
    cs.push({ col: selection.field.col, kind: 'in', part: selection.field.part, values: selection.values });
  }
  return cs;
}

export function filterSummary(slicers: Slicer[], selection: Selection | null, label: (s: Slicer) => string): string {
  const parts = slicers.map(label);
  if (selection) parts.push(selection.label);
  return parts.length ? parts.join('; ') : 'None';
}

export { generateInsights };
