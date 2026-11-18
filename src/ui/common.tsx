// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, Laptop, Moon, Sun, X, AlertTriangle } from 'lucide-react';
import { useStore, type ThemeMode } from '../state/store';

export function useDarkMode() {
  const mode = useStore((s) => s.themeMode);
  const [sys, setSys] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const q = matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setSys(q.matches);
    q.addEventListener('change', fn);
    return () => q.removeEventListener('change', fn);
  }, []);
  return mode === 'dark' || (mode === 'system' && sys);
}

export function ThemeSwitch() {
  const mode = useStore((s) => s.themeMode);
  const setTheme = useStore((s) => s.setTheme);
  const opts: [ThemeMode, ReactNode, string][] = [['light', <Sun size={15} />, 'Light theme'], ['dark', <Moon size={15} />, 'Dark theme'], ['system', <Laptop size={15} />, 'Match device']];
  return (
    <div className="segmented" role="radiogroup" aria-label="Color theme">
      {opts.map(([m, icon, label]) => (
        <button key={m} role="radio" aria-checked={mode === m} aria-label={label} title={label} className={mode === m ? 'on' : ''} onClick={() => setTheme(m)}>{icon}</button>
      ))}
    </div>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="var(--accent)" /><path d="M6.5 17.5v-5M12 17.5v-11M17.5 17.5v-7.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" /></svg>
      <span>Statistical</span>
    </span>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <AlertTriangle size={16} /> : t.kind === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="overlay" role="alert" aria-busy="true">
      <div className="busy-card">
        <div className="spinner" />
        <p>{busy.message}</p>
        {busy.fraction !== undefined && <div className="meter"><i style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></div>}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    addEventListener('keydown', key);
    return () => { removeEventListener('keydown', key); prev?.focus?.(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header><h2>{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Popover({ button, children, align = 'left', label }: { button: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', down);
    addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', down); removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="pop" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{button(open)}</div>
      {open && <div className={`pop-panel ${align}`} role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Sparkline({ points, width = 96, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const d = points.map((p, i) => `${(i / (points.length - 1)) * width},${height - 3 - ((p - min) / (max - min || 1)) * (height - 6)}`).join(' ');
  return <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={d} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
