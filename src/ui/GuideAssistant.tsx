// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Compass, Minus, MousePointerClick, RotateCcw, SkipForward, Target } from 'lucide-react';
import { guidePlan, type GuideStep } from '../core/guide';
import { useStore } from '../state/store';

const DONE_KEY = 'srw-guide-done';
const MIN_KEY = 'srw-guide-min';

function readDone(): string[] {
  try { const v = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function save(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private mode */ }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const visible = (el: Element) => el.getClientRects().length > 0;
const findTarget = (name: string) => [...document.querySelectorAll(`[data-guide="${name}"]`)].find(visible) as HTMLElement | undefined;
const clickable = (el: HTMLElement) => el.matches('button, a, input, label, select, [role="tab"]');

/** Opens the part of the report that holds a hidden target, such as the assistant in the side panel. */
export const GUIDE_REVEAL = 'srw-guide-reveal';

/**
 * The next-step guide in the corner of every screen. It points at the one thing to click next,
 * highlights it on request, and moves on by itself when the person clicks it.
 */
export function GuideAssistant() {
  const route = useStore((s) => s.route);
  const autoMode = useStore((s) => s.autoMode);
  const review = useStore((s) => s.findings.filter((f) => !f.auto && f.severity !== 'info' && s.disabled.includes(f.id)).length);
  const filtered = useStore((s) => s.slicers.length > 0 || Boolean(s.selection));
  const [done, setDone] = useState(readDone);
  // On a phone the guide starts as a small button, so it never covers the page.
  const [min, setMin] = useState(() => { try { const v = localStorage.getItem(MIN_KEY); return v === null ? innerWidth < 700 : v === '1'; } catch { return innerWidth < 700; } });
  const [onScreen, setOnScreen] = useState<string[]>([]);
  const hinted = useRef<HTMLElement | null>(null);

  const markDone = useCallback((...ids: string[]) => {
    setDone((list) => {
      const next = [...new Set([...list, ...ids])];
      if (next.length === list.length) return list;
      save(DONE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Clicking anything that carries a data-guide name counts as doing that step.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-guide]');
      const name = el?.getAttribute('data-guide');
      if (name) markDone(name);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [markDone]);

  // The screen changes without React telling the guide (popovers, side panel, lazy pages), so it looks twice a second.
  useEffect(() => {
    const look = () => {
      const names = [...new Set([...document.querySelectorAll('[data-guide]')].filter(visible).map((el) => el.getAttribute('data-guide') ?? ''))].sort();
      setOnScreen((prev) => (prev.join('|') === names.join('|') ? prev : names));
    };
    look();
    const t = setInterval(look, 500);
    return () => clearInterval(t);
  }, []);

  const plan = useMemo(() => guidePlan({ route, done, onScreen, autoMode, review, filtered }), [route, done, onScreen, autoMode, review, filtered]);
  const step: GuideStep | undefined = plan.pending[0];
  const target = step ? step.targets.find((t) => onScreen.includes(t)) : undefined;

  // A soft pulse stays on the suggested element while the guide is open.
  useEffect(() => {
    const clear = () => { hinted.current?.classList.remove('guide-next'); hinted.current = null; };
    if (min || !target) { clear(); return; }
    const apply = () => {
      const el = findTarget(target);
      if (el !== hinted.current) clear();
      if (el && !el.classList.contains('guide-next')) { el.classList.add('guide-next'); hinted.current = el; }
    };
    apply();
    const t = setInterval(apply, 600);
    return () => { clearInterval(t); clear(); };
  }, [target, min]);

  const reveal = (s: GuideStep) => { if (s.reveal && !target) dispatchEvent(new CustomEvent(GUIDE_REVEAL, { detail: s.reveal })); };

  const spotlight = (s: GuideStep) => {
    reveal(s);
    setTimeout(() => {
      const name = s.targets.find((t) => findTarget(t));
      const el = name ? findTarget(name) : undefined;
      if (!el) return;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      el.classList.remove('guide-spot');
      void el.offsetWidth;
      el.classList.add('guide-spot');
      setTimeout(() => el.classList.remove('guide-spot'), 3200);
    }, s.reveal && !target ? 260 : 0);
  };

  const act = (s: GuideStep) => {
    if (s.reveal && !target) { reveal(s); markDone(s.id); return; }
    const el = target ? findTarget(target) : undefined;
    if (el && clickable(el)) el.click();
    markDone(s.id);
  };

  const collapse = (v: boolean) => { setMin(v); save(MIN_KEY, v ? '1' : '0'); };
  const restart = () => { setDone([]); save(DONE_KEY, null); };

  if (min) {
    return (
      <button className="guide-pill" onClick={() => collapse(false)} aria-label={step ? `Next step: ${step.title}` : 'Open the guide'} title={step?.title ?? 'Guide'}>
        <Compass size={17} /> Next step {step && <i className="guide-dot" aria-hidden="true" />}
      </button>
    );
  }

  const el = target ? findTarget(target) : undefined;
  const canClick = Boolean((el && clickable(el)) || (step?.reveal && !target));
  return (
    <aside className="guide" aria-label="Guide" aria-live="polite">
      <header>
        <span className="guide-badge"><Compass size={15} /> Next step</span>
        <small>{plan.done} of {plan.total}</small>
        <button className="icon-btn sm" aria-label="Minimize the guide" title="Minimize" onClick={() => collapse(true)}><Minus size={14} /></button>
      </header>
      <span className="guide-progress" aria-hidden="true"><i style={{ width: `${(plan.done / Math.max(1, plan.total)) * 100}%` }} /></span>
      {step ? (
        <div className="guide-step" key={step.id}>
          <b>{step.title}</b>
          <p>{step.why}</p>
          <div className="guide-actions">
            <button className="btn sm" onClick={() => spotlight(step)}><Target size={14} /> Show me</button>
            {canClick
              ? <button className="btn sm primary" onClick={() => act(step)}><MousePointerClick size={14} /> Do it</button>
              : <button className="btn sm primary" onClick={() => markDone(step.id)}><Check size={14} /> Got it</button>}
            <button className="link" onClick={() => markDone(step.id)}><SkipForward size={13} /> Skip</button>
          </div>
        </div>
      ) : (
        <div className="guide-step" key="done">
          <b><Check size={15} /> You have tried everything here</b>
          <p>{route === 'report' ? 'Open another sample from the home page to learn more, or keep exploring this report.' : 'Keep going, or start the tips again any time.'}</p>
          <div className="guide-actions"><button className="link" onClick={restart}><RotateCcw size={13} /> Start the tips again</button></div>
        </div>
      )}
    </aside>
  );
}
