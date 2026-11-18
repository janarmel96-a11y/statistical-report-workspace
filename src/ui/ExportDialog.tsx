import { useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, FileBox, FileImage, FileJson, FileSpreadsheet, FileText, Presentation, Sheet, Table } from 'lucide-react';
import { exportCsv, exportPdf, exportPng, exportPptx, exportProject, exportWorkbook, type ExportContext } from '../export/reportExports';
import { keyLabel } from '../core/report';
import { filterSummary, pageConstraints, useStore } from '../state/store';
import { Modal } from './common';

type Kind = 'excel' | 'sheets' | 'pdf' | 'pptx' | 'png' | 'csv' | 'project';

const OPTIONS: { id: Kind; icon: ReactNode; name: string; text: string; tag?: string }[] = [
  { id: 'excel', icon: <FileSpreadsheet size={22} />, name: 'Excel workbook', text: 'Summary, charts, tables with live totals, full data, and every correction.', tag: '.xlsx' },
  { id: 'sheets', icon: <Sheet size={22} />, name: 'Google Sheets', text: 'A workbook prepared to open in Google Sheets with formulas intact.', tag: '.xlsx' },
  { id: 'pdf', icon: <FileText size={22} />, name: 'PDF report', text: 'Key figures, findings, and charts, ready to print or email.', tag: '.pdf' },
  { id: 'pptx', icon: <Presentation size={22} />, name: 'PowerPoint', text: 'A slide for the summary and one for each chart.', tag: '.pptx' },
  { id: 'png', icon: <FileImage size={22} />, name: 'Image of this page', text: 'All charts on the current page in one picture.', tag: '.png' },
  { id: 'csv', icon: <Table size={22} />, name: 'CSV data', text: 'The corrected rows, with the current filters applied.', tag: '.csv' },
  { id: 'project', icon: <FileJson size={22} />, name: 'Report project', text: 'Save everything to reopen on another device.', tag: '.json' },
];

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const hasFilters = s.slicers.length > 0 || Boolean(s.selection);

  const run = async (kind: Kind) => {
    const engine = s.engine!;
    const useFilters = scope === 'filtered';
    const ctx: ExportContext = {
      report: s.report!, engine, table: engine.table, findings: s.findings.filter((f) => !s.disabled.includes(f.id) || !f.steps.length),
      constraints: useFilters ? pageConstraints(s.slicers, s.selection) : [],
      filterText: useFilters ? filterSummary(s.slicers, s.selection, (x) => `${x.col}: ${x.values.map((v) => keyLabel(engine, { col: x.col, part: x.part }, v)).join(', ')}`) : 'None',
      palette: s.palette,
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
        {OPTIONS.map((o) => (
          <li key={o.id}>
            <button disabled={Boolean(busy)} onClick={() => void run(o.id)}>
              <span className="ex-icon">{o.icon}</span>
              <span className="ex-text"><b>{o.name}</b><small>{o.text}</small></span>
              <em>{o.tag}</em>
            </button>
          </li>
        ))}
      </ul>
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
