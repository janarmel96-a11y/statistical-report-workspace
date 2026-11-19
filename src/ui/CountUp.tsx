// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts up to the number inside a formatted value such as "4,894", "₱3.4M", "45.2%", or "$1,102.70".
 * When the value changes, it counts from the number shown before, so filters animate smoothly.
 */
export function CountUp({ text, ms = 1200 }: { text: string; ms?: number }) {
  const m = text.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  const target = m ? Number(m[2].replace(/,/g, '')) : NaN;
  const decimals = m?.[2].includes('.') ? m[2].split('.')[1].length : 0;
  const shownRef = useRef(Number.isFinite(target) && !reduced() ? 0 : target);
  const [value, setValue] = useState(shownRef.current);
  useEffect(() => {
    if (!Number.isFinite(target) || reduced()) { shownRef.current = target; setValue(target); return; }
    const from = shownRef.current;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = from + (target - from) * (1 - (1 - t) ** 3);
      shownRef.current = v;
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  if (!m) return <>{text}</>;
  const shown = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: m[2].includes(',') });
  return <span className="count-up">{m[1]}{shown}{m[3]}</span>;
}
