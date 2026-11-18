// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { safeColor, safeImage, type PageElement } from '../core/design';
import { iconFor } from '../core/fieldIcons';
import { formatPct } from '../core/format';
import { queryCategories } from '../core/report';
import type { Constraint } from '../core/types';
import { pageConstraints, useStore } from '../state/store';
import { FieldIcon } from './FieldIcon';

/** Live counts for each group, each with its own icon, following the current filters. */
export function IconBreakdown({ col, cs, compact }: { col: string; cs: Constraint[]; compact?: boolean }) {
  const engine = useStore((s) => s.engine)!;
  const revision = useStore((s) => s.revision);
  const data = useMemo(() => {
    if (!engine.column(col)) return null;
    const total = engine.rows(cs).length;
    const r = queryCategories(engine, { col }, [{ kind: 'col', col, agg: 'rows' }], cs, { topN: compact ? 4 : 7 });
    const groups = r.categories.map((c, i) => ({ key: c.key, label: c.label, n: r.series[0].data[i] ?? 0 })).filter((g) => g.key !== null && g.n > 0);
    return { total, groups, blank: engine.groupRows(cs, { col }).get(null)?.length ?? 0 };
  }, [engine, col, cs, compact, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <p className="empty-note">This column is not available.</p>;
  if (!data.groups.length) return <p className="empty-note">No records for the current filters.</p>;
  return (
    <ul className={`icon-list ${compact ? 'compact' : ''}`} aria-label={`${col} breakdown`}>
      {data.groups.map((g) => {
        const key = iconFor(g.label);
        const share = data.total ? g.n / data.total : 0;
        return (
          <li key={g.label}>
            <FieldIcon icon={key === 'chart' ? iconFor(col) : key} size={compact ? 15 : 18} />
            <span className="icon-list-name" title={g.label}>{g.label}</span>
            <b>{g.n.toLocaleString('en-US')}</b>
            <small>{formatPct(share)}</small>
            {!compact && <i className="icon-list-bar"><em style={{ width: `${share * 100}%` }} /></i>}
          </li>
        );
      })}
      {!compact && data.blank > 0 && <li className="icon-list-note">Not recorded: {data.blank.toLocaleString('en-US')}</li>}
    </ul>
  );
}

export function ElementCard({ el }: { el: PageElement }) {
  const selected = useStore((s) => s.selectedElement === el.id);
  const select = useStore((s) => s.selectElement);
  const mutatePage = useStore((s) => s.mutatePage);
  const slicers = useStore((s) => s.slicers);
  const selection = useStore((s) => s.selection);
  const cs = useMemo(() => pageConstraints(slicers, selection), [slicers, selection]);
  const color = safeColor(el.color);
  const remove = () => { select(null); mutatePage((p) => ({ ...p, elements: (p.elements ?? []).filter((x) => x.id !== el.id), layout: p.layout.filter((l) => l.i !== el.id) })); };
  const textStyle: CSSProperties = { fontSize: Math.max(10, Math.min(96, el.size ?? 16)), textAlign: el.align ?? 'left', fontWeight: el.bold ? 700 : 450, color: color ?? 'var(--ink)' };
  const image = safeImage(el.image);
  const box = useRef<HTMLDivElement>(null);
  // A new element starts at the bottom of the page, so bring it into view once it is placed.
  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 160);
    return () => clearTimeout(timer);
  }, [selected]);

  return (
    <div ref={box} className={`el-box el-kind-${el.kind} ${selected ? 'selected' : ''}`} onMouseDown={() => select(el.id)} role="group" aria-label={el.kind === 'text' ? 'Text element' : `${el.kind} element`}>
      <div className="card-drag el-grip no-print" title="Drag to move"><GripHorizontal size={14} /></div>
      <button className="icon-btn sm el-remove no-print" aria-label="Remove element" title="Remove" onMouseDown={(e) => e.stopPropagation()} onClick={remove}><X size={13} /></button>
      {el.kind === 'text' && <p className={`el-text ${(el.size ?? 16) >= 20 ? 'head' : ''}`} style={textStyle}>{el.text || 'Add your text'}</p>}
      {el.kind === 'shape' && <div className={`el-shape ${el.shape ?? 'rectangle'}`} style={{ background: color ?? 'var(--accent)' }} />}
      {el.kind === 'icon' && <div className="el-icon-wrap"><FieldIcon icon={el.icon} text={el.text} size={Math.max(20, Math.min(72, el.size ?? 36))} className="big" />{el.text && <b style={{ color }}>{el.text}</b>}</div>}
      {el.kind === 'image' && (image ? <img src={image} alt={el.text || 'Report picture'} /> : <p className="empty-note">This picture is not available.</p>)}
      {el.kind === 'breakdown' && <div className="el-breakdown"><h3><FieldIcon text={el.col} size={15} /> {el.text || el.col}</h3>{el.col && <IconBreakdown col={el.col} cs={cs} />}</div>}
    </div>
  );
}
