// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, FileBox, FileImage, FileJson, FileSpreadsheet, FileText, LockKeyhole, Presentation, Sheet, Table, Video } from 'lucide-react';
import { exportPptx } from '../export/presentation';
import { exportCsv, exportPdf, exportPng, exportProject, exportWorkbook, download, safeFileName, type ExportContext } from '../export/reportExports';
import { keyLabel } from '../core/report';
import { MIN_PASSCODE } from '../export/protectedFile';
import { filterSummary, pageConstraints, useStore } from '../state/store';
import { Modal } from './common';

type Kind = 'excel' | 'sheets' | 'pdf' | 'pptx' | 'png' | 'csv' | 'project' | 'protected';

const OPTIONS: { id: Kind; icon: ReactNode; name: string; text: string; tag?: string }[] = [
  { id: 'excel', icon: <FileSpreadsheet size={22} />, name: 'Excel workbook', text: 'Summary, charts, tables with live totals, full data, and every correction.', tag: '.xlsx' },
  { id: 'sheets', icon: <Sheet size={22} />, name: 'Google Sheets', text: 'A workbook prepared to open in Google Sheets with formulas intact.', tag: '.xlsx' },
  { id: 'pdf', icon: <FileText size={22} />, name: 'PDF report', text: 'Key figures, findings, and charts, ready to print or email.', tag: '.pdf' },
  { id: 'pptx', icon: <Presentation size={22} />, name: 'PowerPoint', text: 'Animated slides that explain each chart, with detailed speaker notes.', tag: '.pptx' },
  { id: 'png', icon: <FileImage size={22} />, name: 'Image of this page', text: 'All charts on the current page in one picture.', tag: '.png' },
  { id: 'csv', icon: <Table size={22} />, name: 'CSV data', text: 'The corrected rows, with the current filters applied.', tag: '.csv' },
  { id: 'project', icon: <FileJson size={22} />, name: 'Report project', text: 'Save everything to reopen on another device.', tag: '.json' },
  { id: 'protected', icon: <LockKeyhole size={22} />, name: 'Protected report', text: 'Encrypted file with separate owner and viewer passcodes.', tag: '.statsecure' },
];

export default function ExportDialog({ onClose, onVideo }: { onClose: () => void; onVideo: () => void }) {
  const s = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const [protecting, setProtecting] = useState(false);
  const [ownerCode, setOwnerCode] = useState('');
  const [viewerCode, setViewerCode] = useState('');
  const visible = OPTIONS.filter((o) => s.accessRole !== 'viewer' || !['csv', 'project', 'protected', 'excel', 'sheets'].includes(o.id));
  const codeProblem = ownerCode.length < MIN_PASSCODE ? `Use at least ${MIN_PASSCODE} characters for the owner passcode.`
    : viewerCode && viewerCode.length < MIN_PASSCODE ? `Use at least ${MIN_PASSCODE} characters for the viewer passcode.`
    : viewerCode === ownerCode ? 'The two passcodes must be different.' : null;

  const exportProtected = async () => {
    setError(null); setDone(null); setBusy('Encrypting the report');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { buildProtectedFile, viewerProject } = await import('../export/protectedFile');
      const owner = { role: 'owner' as const, raws: s.raws, combine: s.combine, locale: s.locale, steps: s.steps, disabledFindings: s.disabled, report: s.report! };
      const viewer = viewerCode ? viewerProject(s.engine!.table, s.report!, s.locale) : null;
      download(await buildProtectedFile(owner, ownerCode, viewer, viewerCode), `${safeFileName(s.report!.title)}.statsecure`, 'application/octet-stream');
      setOwnerCode(''); setViewerCode(''); setProtecting(false); setDone('protected');
    } catch (e) { setError((e as Error).message || 'The protected file could not be created.'); }
    setBusy(null);
  };
  const hasFilters = s.slicers.length > 0 || Boolean(s.selection);

  const run = async (kind: Kind) => {
    if (kind === 'protected') { setProtecting(true); setDone(null); return; }
    const engine = s.engine!;
    const useFilters = scope === 'filtered';
    const ctx: ExportContext = {
      report: s.report!, engine, table: engine.table, findings: s.findings.filter((f) => !s.disabled.includes(f.id) || !f.steps.length),
      constraints: useFilters ? pageConstraints(s.slicers, s.selection) : [],
      filterText: useFilters ? filterSummary(s.slicers, s.selection, (x) => `${x.col}: ${x.values.map((v) => keyLabel(engine, { col: x.col, part: x.part }, v)).join(', ')}`) : 'None',
      palette: s.palette, steps: s.steps,
    };
    setError(null); setDone(null); setBusy('Starting');
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (kind === 'excel' || kind === 'sheets') await exportWorkbook(ctx, kind, setBusy);
      else if (kind === 'pdf') await exportPdf(ctx, setBusy);
      else if (kind === 'pptx') await exportPptx(ctx, setBusy);
      else if (kind === 'png') await exportPng(ctx, s.report!.pages.find((p) => p.id === s.pageId)?.visuals ?? [], setBusy);
      else if (kind === 'csv') exportCsv(ctx);
      else exportProject(ctx, s.raws, { combine: s.combine, locale: s.locale, steps: s.steps, disabledFindings: s.disabled });
      setDone(kind);
    } catch (e) {
      setError((e as Error).message || 'The download could not be created.');
    }
    setBusy(null);
  };

  return (
    <Modal wide title="Download report" onClose={onClose}>
      {hasFilters && (
        <fieldset className="scope"><legend>What to include</legend>
          <label><input type="radio" checked={scope === 'filtered'} onChange={() => setScope('filtered')} /> Current filters</label>
          <label><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All data</label>
        </fieldset>
      )}
      <ul className="exports">
        <li>
          <button disabled={Boolean(busy)} onClick={onVideo}>
            <span className="ex-icon"><Video size={22} /></span>
            <span className="ex-text"><b>Video presentation</b><small>A narrated-style video with scenes, captions, music, and animation.</small></span>
            <em>.mp4</em>
          </button>
        </li>
        {visible.map((o) => (
          <li key={o.id}>
            <button disabled={Boolean(busy)} onClick={() => void run(o.id)}>
              <span className="ex-icon">{o.icon}</span>
              <span className="ex-text"><b>{o.name}</b><small>{o.text}</small></span>
              <em>{o.tag}</em>
            </button>
          </li>
        ))}
      </ul>
      {protecting && (
        <section className="protect-form" aria-label="Protected report">
          <b>Protect this report</b>
          <div className="two">
            <label className="field">Owner passcode <input type="password" autoComplete="new-password" value={ownerCode} onChange={(e) => setOwnerCode(e.target.value)} /><small>Opens everything.</small></label>
            <label className="field">Viewer passcode (optional) <input type="password" autoComplete="new-password" value={viewerCode} onChange={(e) => setViewerCode(e.target.value)} /><small>Opens a copy without names, IDs, contact details, birthdays, or barangay.</small></label>
          </div>
          <p className="hint">A lost passcode cannot be recovered.{ownerCode && codeProblem ? ` ${codeProblem}` : ''}</p>
          <div className="row-wrap"><button className="btn sm" onClick={() => setProtecting(false)}>Cancel</button><button className="btn primary sm" disabled={Boolean(codeProblem) || Boolean(busy)} onClick={() => void exportProtected()}><LockKeyhole size={13} /> Create protected file</button></div>
        </section>
      )}
      <div role="status" aria-live="polite">
        {busy && <p className="notice"><span className="spinner sm" /> {busy}</p>}
        {error && <p className="notice bad">{error} Nothing was downloaded.</p>}
        {done && done !== 'sheets' && <p className="notice good"><CheckCircle2 size={16} /> Your file was checked and downloaded.</p>}
        {done === 'sheets' && (
          <div className="notice good stack">
            <p><CheckCircle2 size={16} /> <b>Your file was checked and downloaded.</b></p>
            <ol>
              <li>Open Google Sheets and sign in to your own Google account.</li>
              <li>Select <b>File</b>, then <b>Import</b>, then <b>Upload</b>.</li>
              <li>Choose the downloaded file, then select <b>Replace spreadsheet</b>.</li>
            </ol>
            <a className="btn sm" href="https://sheets.new" target="_blank" rel="noreferrer noopener">Open Google Sheets <ExternalLink size={13} /></a>
          </div>
        )}
      </div>
      <p className="hint"><FileBox size={13} /> Files are created on this device. Nothing is sent to a server.</p>
    </Modal>
  );
}
