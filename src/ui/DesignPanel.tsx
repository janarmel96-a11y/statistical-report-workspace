// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useRef, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Circle, Copy, Heading1, Heading2, ImagePlus, Minus, PieChart, RotateCcw, Square, Trash2, Type, Upload } from 'lucide-react';
import {
  backgroundLayers, BACKGROUNDS, CARD_STYLES, cleanDesign, CORNERS, DEFAULT_DESIGN, ELEMENT_SIZE, FONTS, resolveDesign, safeColor, TEMPLATES, THEMES, type PageElement, type ReportDesign,
} from '../core/design';
import { ICON_CHOICES, iconFor } from '../core/fieldIcons';
import { newId, pickPlan } from '../core/insights';
import { useStore } from '../state/store';
import { useDarkMode } from './common';
import { FieldIcon } from './FieldIcon';
import { readImageFile } from './imageFile';

const BRAND_KEY = 'srw-brand';
type Brand = Pick<ReportDesign, 'accent' | 'logo' | 'organization' | 'font'>;

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return <details className="design-section" open={open}><summary>{title}</summary><div>{children}</div></details>;
}

function Upload_({ label, onFile }: { label: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button className="btn sm" onClick={() => input.current?.click()}><Upload size={13} /> {label}</button>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={label} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
  </>;
}

function ElementEditor({ el }: { el: PageElement }) {
  const engine = useStore((s) => s.engine)!;
  const mutatePage = useStore((s) => s.mutatePage);
  const select = useStore((s) => s.selectElement);
  const patch = (changes: Partial<PageElement>, history = false) => mutatePage((p) => ({ ...p, elements: (p.elements ?? []).map((x) => (x.id === el.id ? { ...x, ...changes } : x)) }), history);
  const remove = () => { select(null); mutatePage((p) => ({ ...p, elements: (p.elements ?? []).filter((x) => x.id !== el.id), layout: p.layout.filter((l) => l.i !== el.id) })); };
  const copy = () => { const id = newId('e'); mutatePage((p) => { const pos = p.layout.find((l) => l.i === el.id); return { ...p, elements: [...(p.elements ?? []), { ...el, id }], layout: [...p.layout, { i: id, x: pos?.x ?? 0, y: 9999, w: pos?.w ?? 4, h: pos?.h ?? 4 }] }; }); select(id); };
  const groupCols = engine.table.columns.filter((c) => c.type === 'category' || c.type === 'boolean');
  return (
    <section className="design-editor" aria-label="Selected element">
      <h3 className="side-h">Selected {el.kind === 'breakdown' ? 'icon breakdown' : el.kind}</h3>
      {(el.kind === 'text' || el.kind === 'icon' || el.kind === 'breakdown') && <label className="field compact">{el.kind === 'text' ? 'Text' : 'Label'} <textarea className="plain" rows={el.kind === 'text' ? 3 : 1} value={el.text ?? ''} onChange={(e) => patch({ text: e.target.value })} /></label>}
      {(el.kind === 'text' || el.kind === 'icon') && <label className="param"><span>Size <b>{el.size ?? 16}</b></span><input type="range" min={el.kind === 'icon' ? 20 : 11} max={72} value={el.size ?? 16} onChange={(e) => patch({ size: Number(e.target.value) })} /></label>}
      {el.kind === 'text' && (
        <div className="row-wrap design-row">
          <div className="segmented" role="radiogroup" aria-label="Text alignment">
            {([['left', <AlignLeft size={14} />], ['center', <AlignCenter size={14} />], ['right', <AlignRight size={14} />]] as const).map(([a, icon]) => <button key={a} role="radio" aria-checked={(el.align ?? 'left') === a} aria-label={`Align ${a}`} className={(el.align ?? 'left') === a ? 'on' : ''} onClick={() => patch({ align: a }, true)}>{icon}</button>)}
          </div>
          <button className={`icon-btn sm ${el.bold ? 'active' : ''}`} aria-pressed={Boolean(el.bold)} aria-label="Bold" onClick={() => patch({ bold: !el.bold }, true)}><Bold size={14} /></button>
        </div>
      )}
      {(el.kind === 'text' || el.kind === 'shape') && <label className="design-color">Color <input type="color" aria-label="Element color" value={safeColor(el.color) ?? (el.kind === 'text' ? '#0b0b0b' : '#1c5cab')} onChange={(e) => patch({ color: e.target.value })} /></label>}
      {el.kind === 'icon' && <div className="icon-picks" role="radiogroup" aria-label="Choose an icon">{ICON_CHOICES.map((c) => <button key={c.key} role="radio" aria-checked={el.icon === c.key} aria-label={c.name} title={c.name} className={el.icon === c.key ? 'on' : ''} onClick={() => patch({ icon: c.key }, true)}><FieldIcon icon={c.key} size={15} /></button>)}</div>}
      {el.kind === 'breakdown' && <label className="field compact">Column <select value={el.col ?? ''} onChange={(e) => patch({ col: e.target.value }, true)}>{groupCols.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>}
      <div className="row-wrap"><button className="btn sm" onClick={copy}><Copy size={13} /> Duplicate</button><button className="btn sm danger" onClick={remove}><Trash2 size={13} /> Remove</button></div>
    </section>
  );
}

/** One place to set the look of a report and add text, shapes, icons, and pictures. */
export function DesignPanel() {
  const report = useStore((s) => s.report)!;
  const engine = useStore((s) => s.engine)!;
  const pageId = useStore((s) => s.pageId);
  const selectedId = useStore((s) => s.selectedElement);
  const mutateReport = useStore((s) => s.mutateReport);
  const mutatePage = useStore((s) => s.mutatePage);
  const select = useStore((s) => s.selectElement);
  const toast = useStore((s) => s.toast);
  const palette = useStore((s) => s.palette);
  const patterns = useStore((s) => s.patterns);
  const setPalette = useStore((s) => s.setPalette);
  const setPatterns = useStore((s) => s.setPatterns);
  const dark = useDarkMode();
  const design = cleanDesign(report.design);
  const accent = resolveDesign(report.design, dark).vars['--accent'];
  const update = (changes: Partial<ReportDesign>, history = true) => mutateReport((r) => ({ ...r, design: { ...cleanDesign(r.design), ...changes } }), history);
  const page = report.pages.find((p) => p.id === pageId) ?? report.pages[0];
  const selected = page?.elements?.find((e) => e.id === selectedId);

  const add = (el: Omit<PageElement, 'id'>) => {
    const id = newId('e');
    const size = ELEMENT_SIZE[el.kind];
    mutatePage((p) => ({ ...p, elements: [...(p.elements ?? []), { ...el, id }], layout: [...p.layout, { i: id, x: 0, y: 9999, ...size }] }));
    select(id);
  };
  const picture = async (f: File, maxSide: number, keep: boolean, use: (url: string) => void) => {
    try { use(await readImageFile(f, maxSide, keep)); } catch (e) { toast('error', (e as Error).message); }
  };
  const { groups, dims } = pickPlan(engine);
  const firstGroup = groups.sex ?? groups.location[0] ?? dims[0] ?? engine.table.columns.find((c) => c.type === 'category')?.name;

  const saveBrand = () => {
    try { localStorage.setItem(BRAND_KEY, JSON.stringify({ accent: design.accent ?? accent, logo: design.logo, organization: design.organization, font: design.font } satisfies Brand)); toast('success', 'Your brand was saved on this device.'); }
    catch { toast('error', 'Your brand could not be saved in this browser.'); }
  };
  const useBrand = () => {
    try {
      const raw = localStorage.getItem(BRAND_KEY);
      if (!raw) { toast('info', 'Save your brand first.'); return; }
      const b = cleanDesign({ ...design, ...(JSON.parse(raw) as Brand) });
      update({ accent: b.accent, logo: b.logo, organization: b.organization, font: b.font });
    } catch { toast('error', 'Your saved brand could not be read.'); }
  };

  return (
    <div className="design-panel">
      {selected && <ElementEditor key={selected.id} el={selected} />}
      <Section title="Templates" open>
        <div className="template-grid">
          {TEMPLATES.map((t) => {
            const theme = THEMES.find((x) => x.id === t.theme)!;
            const art = backgroundLayers(t.background, theme.accent);
            const on = design.theme === t.theme && design.background === t.background && design.card === t.card && design.font === t.font;
            return (
              <button key={t.id} aria-pressed={on} className={`template-tile ${on ? 'on' : ''}`} style={{ backgroundColor: theme.page, backgroundImage: art.image, backgroundSize: art.size === '100% 230px' ? '100% 70%' : art.size, backgroundRepeat: t.background === 'bars' ? 'no-repeat' : undefined, backgroundPosition: t.background === 'bars' ? 'bottom' : undefined }}
                onClick={() => update({ theme: t.theme, background: t.background, card: t.card, font: t.font, corners: t.corners, accent: undefined, backgroundImage: undefined })}>
                <i style={{ background: theme.accent }} /><b>{t.name}</b><small>{t.note}</small>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Elements">
        <h4>Text</h4>
        <div className="element-grid">
          <button onClick={() => add({ kind: 'text', text: 'Add a heading', size: 34, bold: true })}><Heading1 size={17} /> Heading</button>
          <button onClick={() => add({ kind: 'text', text: 'Add a subheading', size: 22, bold: true })}><Heading2 size={17} /> Subheading</button>
          <button onClick={() => add({ kind: 'text', text: 'Add your explanation here.', size: 15 })}><Type size={17} /> Body text</button>
        </div>
        <h4>Shapes</h4>
        <div className="element-grid">
          <button onClick={() => add({ kind: 'shape', shape: 'rectangle' })}><Square size={17} /> Box</button>
          <button onClick={() => add({ kind: 'shape', shape: 'circle' })}><Circle size={17} /> Circle</button>
          <button onClick={() => add({ kind: 'shape', shape: 'line' })}><Minus size={17} /> Line</button>
        </div>
        <h4>Statistics and pictures</h4>
        <div className="element-grid">
          <button disabled={!firstGroup} onClick={() => add({ kind: 'breakdown', col: firstGroup })}><PieChart size={17} /> Icon breakdown</button>
          <button onClick={() => add({ kind: 'icon', icon: firstGroup ? iconFor(firstGroup) : 'records', text: 'Label', size: 40 })}><FieldIcon icon="sex" size={15} /> Icon</button>
          <label className="element-upload"><ImagePlus size={17} /> Picture<input type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Add a picture" onChange={(e) => { const f = e.target.files?.[0]; if (f) void picture(f, 1400, false, (image) => add({ kind: 'image', image })); e.target.value = ''; }} /></label>
        </div>
      </Section>
      <Section title="Colors">
        <div className="swatches" role="radiogroup" aria-label="Report colors">
          {THEMES.map((t) => <button key={t.id} role="radio" aria-checked={design.theme === t.id && !design.accent} aria-label={t.name} title={t.name} className={design.theme === t.id && !design.accent ? 'on' : ''} style={{ background: t.accent }} onClick={() => update({ theme: t.id, accent: undefined })} />)}
        </div>
        <label className="design-color">Custom color <input type="color" aria-label="Custom report color" value={design.accent ?? THEMES.find((t) => t.id === design.theme)!.accent} onChange={(e) => update({ accent: e.target.value }, false)} /></label>
        <label className="field compact">Chart colors <select aria-label="Chart colors" value={`${palette}${patterns ? '+p' : ''}`} onChange={(e) => { const [p, q] = e.target.value.split('+'); setPalette(p as 'standard' | 'bright'); setPatterns(q === 'p'); }}>
          <option value="standard">Standard</option><option value="bright">Warm first</option><option value="standard+p">With patterns</option>
        </select></label>
      </Section>
      <Section title="Background">
        <div className="background-grid" role="radiogroup" aria-label="Page background">
          {BACKGROUNDS.map((b) => { const art = backgroundLayers(b.id, accent); return <button key={b.id} role="radio" aria-checked={design.background === b.id && !design.backgroundImage} className={design.background === b.id && !design.backgroundImage ? 'on' : ''} onClick={() => update({ background: b.id, backgroundImage: undefined })}><i style={{ backgroundImage: art.image, backgroundSize: b.id === 'bars' ? '100% 100%' : art.size }} /><span>{b.name}</span></button>; })}
        </div>
        <div className="row-wrap">
          <Upload_ label="Use my picture" onFile={(f) => void picture(f, 1920, false, (backgroundImage) => update({ backgroundImage }))} />
          {design.backgroundImage && <button className="btn sm" onClick={() => update({ backgroundImage: undefined })}>Remove picture</button>}
        </div>
      </Section>
      <Section title="Cards and fonts">
        <h4>Card style</h4>
        <div className="choice-row" role="radiogroup" aria-label="Card style">{CARD_STYLES.map((c) => <button key={c.id} role="radio" aria-checked={design.card === c.id} className={design.card === c.id ? 'on' : ''} onClick={() => update({ card: c.id })}>{c.name}</button>)}</div>
        <h4>Corners</h4>
        <div className="choice-row" role="radiogroup" aria-label="Corner style">{CORNERS.map((c) => <button key={c.id} role="radio" aria-checked={design.corners === c.id} className={design.corners === c.id ? 'on' : ''} onClick={() => update({ corners: c.id })}>{c.name}</button>)}</div>
        <h4>Font</h4>
        <div className="font-list" role="radiogroup" aria-label="Report font">{FONTS.map((f) => <button key={f.id} role="radio" aria-checked={design.font === f.id} className={design.font === f.id ? 'on' : ''} style={{ fontFamily: f.head }} onClick={() => update({ font: f.id })}>{f.name}</button>)}</div>
        <label className="switch solo"><input type="checkbox" checked={design.animate !== false} onChange={(e) => update({ animate: e.target.checked })} /><i /><span>Animate cards when presenting</span></label>
      </Section>
      <Section title="Brand">
        <label className="field compact">Organization name <input value={design.organization ?? ''} maxLength={80} onChange={(e) => update({ organization: e.target.value }, false)} /></label>
        <div className="row-wrap design-row">
          <Upload_ label="Add logo" onFile={(f) => void picture(f, 360, true, (logo) => update({ logo }))} />
          {design.logo && <button className="btn sm" onClick={() => update({ logo: undefined })}>Remove logo</button>}
        </div>
        <div className="row-wrap"><button className="btn sm" onClick={saveBrand}>Save my brand</button><button className="btn sm" onClick={useBrand}>Use my brand</button></div>
      </Section>
      <button className="btn sm design-reset" onClick={() => update({ ...DEFAULT_DESIGN, accent: undefined, backgroundImage: undefined })}><RotateCcw size={13} /> Reset the design</button>
    </div>
  );
}
