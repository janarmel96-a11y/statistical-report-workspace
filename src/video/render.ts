// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { captionsFor, sizeOf, STYLES, TRANSITION_SECONDS, type Timeline, type VideoProject, type VideoScene, type VideoStyle } from './project';

/** Draws any moment of the video. The same code powers the preview and the exported file. */

export type Assets = Map<string, CanvasImageSource & { width: number; height: number }>;
type Ctx = CanvasRenderingContext2D;

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => { const t = clamp(x); return 1 - (1 - t) ** 3; };

function wrap(c: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (c.measureText(next).width <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    line = words[i];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const used = lines.join(' ').split(/\s+/).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && c.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function rounded(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function text(c: Ctx, lines: string[], x: number, y: number, lineHeight: number) {
  lines.forEach((l, i) => c.fillText(l, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function background(c: Ctx, W: number, H: number, st: VideoStyle, scene: VideoScene, t: number) {
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, scene.background ?? st.bg[0]);
  g.addColorStop(1, scene.background ?? st.bg[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.save();
  c.globalAlpha = 0.09;
  c.fillStyle = st.accent;
  const u = Math.max(W, H);
  c.beginPath(); c.arc(W * 0.86 + Math.sin(t * 0.25) * u * 0.02, H * 0.14 + Math.cos(t * 0.2) * u * 0.02, u * 0.17, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(W * 0.08 - Math.sin(t * 0.18) * u * 0.02, H * 0.92, u * 0.12, 0, Math.PI * 2); c.fill();
  c.restore();
}

function presenter(c: Ctx, W: number, H: number, s: number, st: VideoStyle, t: number, speaking: boolean, raised: number) {
  const r = 62 * s;
  const [x, y] = [W - r - 30 * s, H - r - raised - 22 * s];
  c.save();
  c.beginPath(); c.arc(x, y, r + 4 * s, 0, Math.PI * 2); c.fillStyle = st.accent; c.fill();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = '#eaf1fb'; c.fill(); c.clip();
  const bob = Math.sin(t * 2) * 1.5 * s;
  c.fillStyle = '#1f3a63'; c.beginPath(); c.ellipse(x, y + r * 1.02, r * 0.82, r * 0.72, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(x - r * 0.2, y + r * 0.34); c.lineTo(x + r * 0.2, y + r * 0.34); c.lineTo(x, y + r * 0.72); c.closePath(); c.fill();
  c.fillStyle = '#d9a37e'; c.fillRect(x - r * 0.14, y + r * 0.12 + bob, r * 0.28, r * 0.28);
  c.beginPath(); c.ellipse(x, y - r * 0.12 + bob, r * 0.4, r * 0.47, 0, 0, Math.PI * 2); c.fillStyle = '#e8b890'; c.fill();
  c.fillStyle = '#2b2118'; c.beginPath(); c.ellipse(x, y - r * 0.44 + bob, r * 0.43, r * 0.26, 0, Math.PI, Math.PI * 2); c.fill();
  c.fillRect(x - r * 0.43, y - r * 0.46 + bob, r * 0.86, r * 0.1);
  const blink = (t % 3.7) < 0.13 ? 0.12 : 1;
  c.fillStyle = '#20150d';
  [-0.16, 0.16].forEach((d) => { c.beginPath(); c.ellipse(x + r * d, y - r * 0.16 + bob, r * 0.045, r * 0.06 * blink, 0, 0, Math.PI * 2); c.fill(); });
  const open = speaking ? 0.03 + Math.abs(Math.sin(t * 11) * Math.sin(t * 3.3)) * 0.09 : 0.012;
  c.fillStyle = '#8a3a2e'; c.beginPath(); c.ellipse(x, y + r * 0.1 + bob, r * 0.12, r * open, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}

function kpiCards(c: Ctx, scene: VideoScene, st: VideoStyle, x: number, y: number, w: number, h: number, s: number, t: number, vertical: boolean) {
  const list = scene.kpis ?? [];
  const cols = vertical ? (list.length > 2 ? 2 : 1) : Math.max(1, list.length);
  const rows = Math.ceil(list.length / cols);
  const gap = 18 * s;
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = Math.min((h - gap * (rows - 1)) / rows, 240 * s);
  list.forEach((k, i) => {
    const p = ease((t - 0.5 - i * 0.28) / 0.6);
    if (p <= 0) return;
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + gap) + (1 - p) * 26 * s;
    c.save();
    c.globalAlpha = p;
    rounded(c, cx, cy, cw, ch, 16 * s); c.fillStyle = st.card; c.fill();
    c.fillStyle = st.accent; rounded(c, cx, cy, 6 * s, ch, 3 * s); c.fill();
    c.fillStyle = st.cardInk; c.textBaseline = 'top';
    c.font = `500 ${19 * s}px ${FONT}`; text(c, wrap(c, k.label, cw - 44 * s, 2), cx + 24 * s, cy + 24 * s, 24 * s);
    c.font = `700 ${Math.min(50 * s, cw / 5.2)}px ${FONT}`; c.fillText(k.value, cx + 24 * s, cy + ch * 0.42);
    if (k.note) { c.font = `600 ${17 * s}px ${FONT}`; c.globalAlpha = p * 0.8; c.fillText(k.note, cx + 24 * s, cy + ch - 40 * s); }
    c.restore();
  });
}

function bulletsAt(c: Ctx, items: string[], st: VideoStyle, x: number, y: number, w: number, s: number, t: number, seconds: number, size = 24) {
  let at = y;
  const span = Math.max(1.5, seconds * 0.55);
  items.forEach((b, i) => {
    const p = ease((t - 1 - (i * span) / Math.max(1, items.length)) / 0.5);
    c.font = `500 ${size * s}px ${FONT}`;
    const lines = wrap(c, b, w - 56 * s, 3);
    const h = lines.length * (size + 7) * s + 30 * s;
    if (p > 0) {
      c.save();
      c.globalAlpha = p;
      const dx = (1 - p) * 30 * s;
      rounded(c, x + dx, at, w, h, 14 * s); c.fillStyle = st.card; c.fill();
      c.fillStyle = st.accent; c.beginPath(); c.arc(x + dx + 24 * s, at + h / 2, 6 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = st.cardInk; c.textBaseline = 'top';
      text(c, lines, x + dx + 44 * s, at + 15 * s, (size + 7) * s);
      c.restore();
    }
    at += h + 14 * s;
  });
}

function chartCard(c: Ctx, img: Assets extends Map<string, infer V> ? V : never, scene: VideoScene, x: number, y: number, w: number, h: number, s: number, t: number, seconds: number) {
  const fit = Math.min(w / img.width, h / img.height);
  const [iw, ih] = [img.width * fit, img.height * fit];
  const [ix, iy] = [x + (w - iw) / 2, y + (h - ih) / 2];
  const p = ease((t - 0.45) / 1);
  if (p <= 0) return;
  c.save();
  c.globalAlpha = scene.animation === 'wipe' ? 1 : p;
  const lift = scene.animation === 'rise' ? (1 - p) * 34 * s : 0;
  rounded(c, ix - 10 * s, iy - 10 * s + lift, iw + 20 * s, ih + 20 * s, 16 * s);
  c.fillStyle = '#ffffff';
  c.shadowColor = 'rgba(0,0,0,.22)'; c.shadowBlur = 26 * s; c.shadowOffsetY = 8 * s;
  c.fill();
  c.shadowColor = 'transparent';
  c.clip();
  if (scene.animation === 'wipe') { c.beginPath(); c.rect(ix - 10 * s, iy - 10 * s, (iw + 20 * s) * p, ih + 20 * s); c.clip(); }
  const slow = 1 + (scene.animation === 'zoom' ? (1 - p) * 0.08 : 0) + (clamp(t / seconds) * 0.025);
  c.translate(ix + iw / 2, iy + ih / 2 + lift);
  c.scale(slow, slow);
  c.drawImage(img as CanvasImageSource, -iw / 2, -ih / 2, iw, ih);
  c.restore();
}

export function drawScene(c: Ctx, project: VideoProject, scene: VideoScene, t: number, seconds: number, assets: Assets) {
  const { width: W, height: H } = sizeOf(project);
  const st = STYLES.find((x) => x.id === project.styleId) ?? STYLES[0];
  const s = Math.min(W, H) / 720;
  const vertical = project.format !== 'landscape';
  const m = 52 * s;
  background(c, W, H, st, scene, t);
  c.textBaseline = 'top';
  c.textAlign = 'left';
  const enter = ease(t / 0.7);
  const hero = scene.kind === 'title' || scene.kind === 'closing';
  const capH = project.captions ? (vertical ? 170 : 104) * s : 30 * s;

  c.save();
  c.globalAlpha = enter;
  c.translate(0, (1 - enter) * 22 * s);
  let y = hero ? H * 0.33 : m * 0.8;
  c.fillStyle = st.accent;
  c.font = `700 ${(hero ? 24 : 19) * s}px ${FONT}`;
  c.fillText(scene.kicker.toUpperCase(), m, y);
  y += (hero ? 42 : 31) * s;
  c.fillStyle = st.ink;
  const titleSize = (hero ? (vertical ? 58 : 66) : vertical ? 36 : 39) * s;
  c.font = `700 ${titleSize}px ${FONT}`;
  y = text(c, wrap(c, scene.title, W - 2 * m, hero ? 3 : 2), m, y, titleSize * 1.14) + 18 * s;
  c.restore();

  if (hero) {
    const p = ease((t - 0.8) / 0.7);
    c.save(); c.globalAlpha = p; c.fillStyle = st.sub; c.font = `500 ${27 * s}px ${FONT}`;
    text(c, wrap(c, scene.bullets[0] ?? '', W - 2 * m, 4), m, y + 10 * s, 37 * s);
    c.fillStyle = st.accent; c.fillRect(m, y - 2 * s, 120 * s * p, 5 * s);
    c.restore();
  } else if (scene.kind === 'kpis') {
    kpiCards(c, scene, st, m, y + 18 * s, W - 2 * m, H - y - capH - 48 * s, s, t, vertical);
  } else {
    const img = scene.visualId ? assets.get(scene.visualId) : assets.get(scene.id);
    const bottom = H - capH - 18 * s;
    if (img && !vertical) {
      const cw = (W - 2 * m) * 0.64;
      chartCard(c, img, scene, m, y + 4 * s, cw, bottom - y - 8 * s, s, t, seconds);
      bulletsAt(c, scene.bullets, st, m + cw + 28 * s, y + 12 * s, W - 2 * m - cw - 28 * s, s, t, seconds, 21);
    } else if (img) {
      const ch = (bottom - y) * 0.52;
      chartCard(c, img, scene, m, y + 4 * s, W - 2 * m, ch, s, t, seconds);
      bulletsAt(c, scene.bullets, st, m, y + ch + 26 * s, W - 2 * m, s, t, seconds, 24);
    } else bulletsAt(c, scene.bullets, st, m, y + 16 * s, W - 2 * m, s, t, seconds, 28);
  }

  if (project.presenter) presenter(c, W, H, s, st, t, t > 0.3 && t < seconds - 0.4, project.captions ? capH - 10 * s : 0);

  if (project.captions) {
    const cap = captionsFor(scene.narration, seconds).find((x) => t >= x.start && t < x.end);
    if (cap) {
      const size = (vertical ? 30 : 27) * s;
      c.font = `600 ${size}px ${FONT}`;
      const lines = wrap(c, cap.text, W - 2 * m - (project.presenter ? 150 * s : 0), 3);
      const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 40 * s;
      const h = lines.length * size * 1.28 + 22 * s;
      const x = (W - w) / 2;
      const yy = H - h - 26 * s;
      rounded(c, x, yy, w, h, 10 * s); c.fillStyle = 'rgba(8,12,20,.8)'; c.fill();
      c.fillStyle = '#ffffff'; c.textAlign = 'center';
      text(c, lines, W / 2, yy + 11 * s, size * 1.28);
      c.textAlign = 'left';
    }
  }
}

const layers = new Map<string, HTMLCanvasElement>();
function layer(name: string, W: number, H: number) {
  let el = layers.get(name);
  if (!el) { el = document.createElement('canvas'); layers.set(name, el); }
  if (el.width !== W || el.height !== H) { el.width = W; el.height = H; }
  return el;
}

/** Draws the video at a point in time, blending scenes during a transition. */
export function drawFrame(c: Ctx, project: VideoProject, tl: Timeline, time: number, assets: Assets) {
  const { width: W, height: H } = sizeOf(project);
  const T = Math.max(0, Math.min(time, Math.max(0, tl.total - 0.001)));
  let i = tl.starts.findIndex((st, k) => T >= st && T < st + tl.durations[k]);
  if (i < 0) i = project.scenes.length - 1;
  const scene = project.scenes[i];
  if (!scene) { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); return; }
  const t = T - tl.starts[i];
  const inTransition = i > 0 && scene.transition !== 'none' && t < TRANSITION_SECONDS;
  if (!inTransition) {
    drawScene(c, project, scene, t, tl.durations[i], assets);
  } else {
    const a = layer('a', W, H);
    const b = layer('b', W, H);
    drawScene(a.getContext('2d')!, project, project.scenes[i - 1], tl.durations[i - 1], tl.durations[i - 1], assets);
    drawScene(b.getContext('2d')!, project, scene, t, tl.durations[i], assets);
    const p = ease(t / TRANSITION_SECONDS);
    c.drawImage(a, 0, 0);
    c.save();
    if (scene.transition === 'fade') c.globalAlpha = p;
    if (scene.transition === 'slide') c.translate((1 - p) * W, 0);
    if (scene.transition === 'zoom') { c.globalAlpha = p; const z = 0.92 + 0.08 * p; c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2, -H / 2); }
    c.drawImage(b, 0, 0);
    c.restore();
  }
  c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect(0, H - 5, W, 5);
  const st = STYLES.find((x) => x.id === project.styleId) ?? STYLES[0];
  c.fillStyle = st.accent; c.fillRect(0, H - 5, (T / Math.max(0.001, tl.total)) * W, 5);
}
