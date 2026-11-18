// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { SceneKind, StoryKpi, StoryScene } from '../core/story';

export type VideoFormat = 'landscape' | 'portrait' | 'square';
export type Transition = 'none' | 'fade' | 'slide' | 'zoom';
export type Animation = 'wipe' | 'zoom' | 'rise';
export type Music = 'none' | 'calm' | 'bright';
export type Quality = 720 | 1080;

export interface VideoScene {
  id: string;
  kind: SceneKind;
  kicker: string;
  title: string;
  bullets: string[];
  narration: string;
  kpis?: StoryKpi[];
  visualId?: string;
  transition: Transition;
  animation: Animation;
  background?: string;
  /** Set when the person fixes this scene's length by hand. */
  seconds?: number;
}

export interface VideoStyle { id: string; name: string; bg: [string, string]; ink: string; sub: string; accent: string; card: string; cardInk: string }

export const STYLES: VideoStyle[] = [
  { id: 'boardroom', name: 'Boardroom', bg: ['#0e2240', '#17345f'], ink: '#ffffff', sub: '#cde2fb', accent: '#5598e7', card: '#1c3a68', cardInk: '#ffffff' },
  { id: 'clean', name: 'Clean', bg: ['#fcfcfb', '#eef2f7'], ink: '#0f1b2d', sub: '#52606f', accent: '#1c5cab', card: '#e8f0fb', cardInk: '#0f1b2d' },
  { id: 'emerald', name: 'Emerald', bg: ['#07332b', '#0e5245'], ink: '#ffffff', sub: '#c5ecdf', accent: '#3fd0a0', card: '#116050', cardInk: '#ffffff' },
  { id: 'sunrise', name: 'Sunrise', bg: ['#fff6ec', '#ffe6d1'], ink: '#35200f', sub: '#6e4c33', accent: '#d9541e', card: '#ffffff', cardInk: '#35200f' },
];

export interface VideoProject {
  format: VideoFormat;
  quality: Quality;
  styleId: string;
  music: Music;
  captions: boolean;
  presenter: boolean;
  /** Words spoken per second when scene length is calculated from the script. */
  pace: number;
  scenes: VideoScene[];
}

export const TRANSITION_SECONDS = 0.6;

export function sizeOf(p: Pick<VideoProject, 'format' | 'quality'>): { width: number; height: number } {
  const short = p.quality;
  const long = p.quality === 1080 ? 1920 : 1280;
  if (p.format === 'landscape') return { width: long, height: short };
  if (p.format === 'portrait') return { width: short, height: long };
  return { width: short, height: short };
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Long enough to read the whole script aloud, with a short pause at the end. */
export function sceneSeconds(s: VideoScene, pace: number, voiceSeconds?: number): number {
  if (voiceSeconds) return Math.max(voiceSeconds + 0.6, 3);
  if (s.seconds) return s.seconds;
  return Math.max(4, Math.round((wordCount(s.narration) / pace + 1.2) * 10) / 10);
}

export interface Timeline { starts: number[]; durations: number[]; total: number }

export function timelineOf(p: VideoProject, voices: Map<string, number>): Timeline {
  const durations = p.scenes.map((s) => sceneSeconds(s, p.pace, voices.get(s.id)));
  const starts: number[] = [];
  let t = 0;
  durations.forEach((d) => { starts.push(t); t += d; });
  return { starts, durations, total: t };
}

export interface Caption { start: number; end: number; text: string }

/** Splits a script into short lines, timed by how many words each one holds. */
export function captionsFor(narration: string, seconds: number): Caption[] {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[][] = [];
  let cur: string[] = [];
  words.forEach((w) => {
    cur.push(w);
    if (cur.length >= 11 || (/[.!?]$/.test(w) && cur.length >= 3) || (/[,;:]$/.test(w) && cur.length >= 7)) { lines.push(cur); cur = []; }
  });
  if (cur.length) lines.push(cur);
  const usable = Math.max(1, seconds - 0.6);
  let at = 0.2;
  return lines.map((l) => {
    const d = (l.length / words.length) * usable;
    const c = { start: at, end: at + d, text: l.join(' ') };
    at += d;
    return c;
  });
}

const stamp = (t: number, sep: string) => {
  const ms = Math.round(t * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

/** Subtitles in the SubRip format used by most video players. */
export function subtitles(p: VideoProject, t: Timeline): string {
  let n = 1;
  return p.scenes.flatMap((s, i) => captionsFor(s.narration, t.durations[i]).map((c) => `${n++}\n${stamp(t.starts[i] + c.start, ',')} --> ${stamp(t.starts[i] + c.end, ',')}\n${c.text}\n`)).join('\n');
}

const TRANSITION_CYCLE: Transition[] = ['fade', 'slide', 'fade', 'zoom'];
const ANIMATION_CYCLE: Animation[] = ['wipe', 'zoom', 'rise'];

export const toVideoScenes = (story: StoryScene[]): VideoScene[] => story.map((s, i) => ({
  ...s, transition: i === 0 ? 'none' : TRANSITION_CYCLE[i % TRANSITION_CYCLE.length], animation: ANIMATION_CYCLE[i % ANIMATION_CYCLE.length],
}));

export function newScene(): VideoScene {
  return { id: `custom${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, kind: 'custom', kicker: 'Note', title: 'New scene', bullets: ['Add a key point'], narration: 'Add what should be said in this scene.', transition: 'fade', animation: 'rise' };
}
