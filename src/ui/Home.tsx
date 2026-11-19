// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, ClipboardList, Combine, FileSpreadsheet, FileUp, ListChecks, Pencil, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { ACCEPT } from '../ingest';
import { deleteProject, listProjects, loadProject, renameSavedProject, type ProjectSummary } from '../state/persist';
import { useStore } from '../state/store';
import { Logo, ThemeSwitch } from './common';
import { NameInput } from './NameInput';
import { PrivacyDialog } from './PrivacyDialog';

const CombineDialog = lazy(() => import('./CombineDialog'));
const MswdDialog = lazy(() => import('./MswdDialog'));

const SAMPLES = [
  { file: 'retail-sales.csv', name: 'Retail sales', meta: '3 years · 1,500 orders', note: 'Includes planted calculation errors, so you can watch them get fixed.' },
  { file: 'service-operations.csv', name: 'Service operations', meta: '2 years · 900 tickets', note: 'Response times, satisfaction scores, and team workload.' },
];

const STEPS = [
  { icon: FileUp, title: 'Add a file', text: 'Excel, CSV, JSON, or PDF tables.' },
  { icon: ListChecks, title: 'Errors get corrected', text: 'Wrong totals, bad formulas, duplicates, and mistyped numbers are found and fixed.' },
  { icon: BarChart3, title: 'Explore the report', text: 'Charts, findings, filters, and drill-down are built for you.' },
  { icon: FileSpreadsheet, title: 'Download it', text: 'Excel, Google Sheets, PDF, PowerPoint, PNG, or CSV.' },
];

export function Home() {
  const importFiles = useStore((s) => s.importFiles);
  const loadSample = useStore((s) => s.loadSample);
  const openRecord = useStore((s) => s.openRecord);
  const toast = useStore((s) => s.toast);
  const autoMode = useStore((s) => s.autoMode);
  const setAutoMode = useStore((s) => s.setAutoMode);
  const [drag, setDrag] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [combining, setCombining] = useState(false);
  const [mswd, setMswd] = useState(false);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const renameRecent = async (id: string, name: string) => {
    setRenaming(null);
    if (name === recent.find((r) => r.id === id)?.name) return;
    if (!await renameSavedProject(id, name)) { toast('error', 'This report is no longer available.'); return; }
    setRecent((list) => list.map((r) => (r.id === id ? { ...r, name } : r)));
    const open = useStore.getState();
    if (open.projectId === id) open.renameProject(name);
  };

  useEffect(() => { void listProjects().then(setRecent); }, []);

  const onFiles = (list: FileList | null) => { if (list?.length) void importFiles([...list]); };

  return (
    <div className="home">
      <header className="home-bar">
        <Logo />
        <ThemeSwitch />
      </header>
      <main className="home-main">
        <section className="hero">
          <h1>Turn any data file into a report you can trust.</h1>
          <p>Add a spreadsheet and get corrected numbers, clear charts, and a file ready to share. No account needed, and your data never leaves this device.</p>
        </section>

        <section className="home-grid">
          <div
            className={`drop ${drag ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
          >
            <span className="drop-icon"><Upload size={26} /></span>
            <h2>Drop your file here</h2>
            <p>Excel (.xlsx, .xls), CSV, JSON, or PDF, up to 200 MB</p>
            <button className="btn primary lg" onClick={() => input.current?.click()}>Choose a file</button>
            <input ref={input} type="file" accept={ACCEPT} multiple hidden aria-label="Choose data files" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
            <div className="auto-mode">
              <label className="switch">
                <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} />
                <i /> <span>Automatic report</span>
              </label>
              <small>{autoMode ? 'Your report opens right after upload, with errors already corrected.' : 'Turn on to skip the review step and open the finished report right after upload.'}</small>
            </div>
          </div>

          <div className="samples">
            <h2>Try it with sample data</h2>
            {SAMPLES.map((s) => (
              <button key={s.file} className="sample" onClick={() => void loadSample(`samples/${s.file}`, s.file)}>
                <span><b>{s.name}</b><small>{s.meta}</small><em>{s.note}</em></span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>

          <div className="combine-card mswd-card">
            <span className="drop-icon"><ClipboardList size={22} /></span>
            <span><h2>MSWD performance report</h2><p>Turn the NEW and OLD patient responses into the MSWD performance workbook: patients catered per RSW and month, dashboard, data checks, and worker report.</p></span>
            <button className="btn primary" onClick={() => setMswd(true)}>Create MSWD report <ArrowRight size={15} /></button>
          </div>

          <div className="combine-card">
            <span className="drop-icon"><Combine size={22} /></span>
            <span><h2>Combine files</h2><p>Stack two or more files with the same headers into one clean file.</p></span>
            <button className="btn" onClick={() => setCombining(true)}>Combine files <ArrowRight size={15} /></button>
          </div>

          {recent.length > 0 && (
            <div className="recent">
              <h2>Continue where you left off</h2>
              <ul>
                {recent.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    {renaming === r.id ? (
                      <div className="recent-rename"><NameInput autoFocus label={`New name for ${r.name}`} value={r.name} onCommit={(name) => { void renameRecent(r.id, name); }} onCancel={() => setRenaming(null)} /></div>
                    ) : (
                      <button className="recent-open" onClick={async () => { const p = await loadProject(r.id); if (p) openRecord(p); else toast('error', 'This report is no longer available.'); }}>
                        <b>{r.name}</b>
                        <small>{r.rowCount.toLocaleString()} rows · {r.columnCount} columns · {new Date(r.updatedAt).toLocaleDateString()}</small>
                      </button>
                    )}
                    <button className="icon-btn" aria-label={`Rename ${r.name}`} title="Rename" onClick={() => setRenaming(r.id)}><Pencil size={15} /></button>
                    <button className="icon-btn" aria-label={`Remove ${r.name}`} title="Remove from this device" onClick={async () => { await deleteProject(r.id); setRecent((x) => x.filter((y) => y.id !== r.id)); }}><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ol className="how">
            {STEPS.map((s, i) => (
              <li key={s.title}><span className="how-n">{i + 1}</span><s.icon size={20} /><b>{s.title}</b><p>{s.text}</p></li>
            ))}
          </ol>
        </section>
        <footer className="home-foot">
          <p><ShieldCheck size={15} /> Files are processed in your browser. Nothing is uploaded and no analytics are collected. <button className="link" onClick={() => setPrivacy(true)}>Privacy and security</button></p>
          <p className="credit">Created by Jan Armel Java Ajeno</p>
        </footer>
      </main>
      {combining && <Suspense fallback={null}><CombineDialog onClose={() => setCombining(false)} /></Suspense>}
      {mswd && <Suspense fallback={null}><MswdDialog onClose={() => setMswd(false)} /></Suspense>}
      {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} onDeleted={() => setRecent([])} />}
    </div>
  );
}
