// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { IconKey } from './fieldIcons';

/** The look of a report. Every value is checked before use, because reports can be opened from shared files. */

export interface ReportDesign {
  theme: string;
  background: string;
  card: string;
  font: string;
  corners: string;
  accent?: string;
  backgroundImage?: string;
  logo?: string;
  organization?: string;
  animate?: boolean;
}

export type ElementKind = 'text' | 'shape' | 'icon' | 'image' | 'breakdown';
export interface PageElement {
  id: string;
  kind: ElementKind;
  text?: string;
  size?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  color?: string;
  shape?: 'rectangle' | 'circle' | 'line';
  icon?: IconKey;
  image?: string;
  col?: string;
}

interface Theme { id: string; name: string; accent: string; accentDark: string; page: string; pageDark: string; series: string[] | null }

/** Chart colors were checked for color-blind separation and contrast on a light page. */
export const THEMES: Theme[] = [
  { id: 'classic', name: 'Classic blue', accent: '#1c5cab', accentDark: '#3987e5', page: '#f6f6f3', pageDark: '#0d0d0d', series: null },
  { id: 'ocean', name: 'Ocean', accent: '#0b6aa8', accentDark: '#45a5e0', page: '#edf5fa', pageDark: '#0a1419', series: null },
  { id: 'emerald', name: 'Emerald', accent: '#0f7a60', accentDark: '#3fc79f', page: '#edf6f2', pageDark: '#0a1411', series: ['#0f8a6d', '#d9541e', '#2563c9', '#b7791f', '#c0357a', '#6d3fc4'] },
  { id: 'royal', name: 'Royal', accent: '#5b34b0', accentDark: '#a48cf0', page: '#f3f0fb', pageDark: '#100d18', series: ['#6d3fc4', '#d9541e', '#0f8a6d', '#b7791f', '#c0357a', '#2563c9'] },
  { id: 'sunset', name: 'Sunset', accent: '#b8430f', accentDark: '#f08a55', page: '#fdf3ec', pageDark: '#170f0a', series: ['#c2410c', '#1d6fb8', '#0f8a6d', '#a16207', '#7c3aed', '#be185d'] },
  { id: 'rose', name: 'Rose', accent: '#b0295f', accentDark: '#ee7fa8', page: '#fcf0f5', pageDark: '#170b10', series: ['#be2f6b', '#2563c9', '#0f8a6d', '#b7791f', '#6d3fc4', '#d9541e'] },
  { id: 'slate', name: 'Slate', accent: '#334e68', accentDark: '#8fb0cf', page: '#eff2f5', pageDark: '#0d1014', series: null },
  { id: 'graphite', name: 'Graphite', accent: '#3f3f46', accentDark: '#b9b9c2', page: '#f2f2f0', pageDark: '#0e0e0f', series: null },
];

export const BACKGROUNDS = [
  { id: 'none', name: 'Plain' }, { id: 'gradient', name: 'Soft fade' }, { id: 'aurora', name: 'Aurora' }, { id: 'dots', name: 'Dots' },
  { id: 'grid', name: 'Graph paper' }, { id: 'diagonal', name: 'Fine lines' }, { id: 'waves', name: 'Waves' }, { id: 'hexagons', name: 'Hexagons' },
  { id: 'rings', name: 'Rings' }, { id: 'bars', name: 'Rising bars' },
];
export const CARD_STYLES = [
  { id: 'solid', name: 'Solid' }, { id: 'raised', name: 'Raised' }, { id: 'glass', name: 'Glass' },
  { id: 'outline', name: 'Outline' }, { id: 'accent', name: 'Top accent' }, { id: 'band', name: 'Color band' },
];
export const FONTS = [
  { id: 'modern', name: 'Modern', body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', head: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'elegant', name: 'Elegant', body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', head: 'Georgia, Cambria, "Times New Roman", serif' },
  { id: 'friendly', name: 'Friendly', body: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif', head: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif' },
  { id: 'formal', name: 'Formal', body: 'Cambria, Georgia, "Times New Roman", serif', head: 'Cambria, Georgia, "Times New Roman", serif' },
  { id: 'clear', name: 'Clear', body: 'Verdana, Tahoma, "Segoe UI", sans-serif', head: 'Tahoma, Verdana, "Segoe UI", sans-serif' },
];
export const CORNERS = [{ id: 'square', name: 'Square', radius: '4px' }, { id: 'soft', name: 'Soft', radius: '14px' }, { id: 'round', name: 'Round', radius: '26px' }];

type Look = Pick<ReportDesign, 'theme' | 'background' | 'card' | 'font' | 'corners'>;
export const TEMPLATES: ({ id: string; name: string; note: string } & Look)[] = [
  { id: 'executive', name: 'Executive', note: 'Calm and formal', theme: 'slate', background: 'gradient', card: 'raised', font: 'elegant', corners: 'soft' },
  { id: 'health', name: 'Health report', note: 'Clean and caring', theme: 'emerald', background: 'waves', card: 'accent', font: 'modern', corners: 'soft' },
  { id: 'community', name: 'Community', note: 'Warm and friendly', theme: 'sunset', background: 'dots', card: 'solid', font: 'friendly', corners: 'round' },
  { id: 'insight', name: 'Data insight', note: 'Modern statistics', theme: 'ocean', background: 'bars', card: 'glass', font: 'modern', corners: 'soft' },
  { id: 'royal', name: 'Boardroom', note: 'Bold presentation', theme: 'royal', background: 'aurora', card: 'band', font: 'modern', corners: 'soft' },
  { id: 'paper', name: 'Research paper', note: 'Simple and printable', theme: 'graphite', background: 'grid', card: 'outline', font: 'formal', corners: 'square' },
  { id: 'care', name: 'Care program', note: 'Soft and bright', theme: 'rose', background: 'rings', card: 'raised', font: 'friendly', corners: 'round' },
  { id: 'technical', name: 'Technical', note: 'Sharp and precise', theme: 'classic', background: 'hexagons', card: 'outline', font: 'clear', corners: 'square' },
];

export const DEFAULT_DESIGN: ReportDesign = { theme: 'classic', background: 'none', card: 'solid', font: 'modern', corners: 'soft', animate: true };

const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
export const safeColor = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v) ? v : undefined);
export const safeImage = (v: unknown): string | undefined => (typeof v === 'string' && v.length < 6_000_000 && IMAGE.test(v) ? v : undefined);

const known = (list: { id: string }[], v: unknown, fallback: string) => (list.some((x) => x.id === v) ? (v as string) : fallback);

export function cleanDesign(raw?: Partial<ReportDesign> | null): ReportDesign {
  const d = raw ?? {};
  return {
    theme: known(THEMES, d.theme, DEFAULT_DESIGN.theme), background: known(BACKGROUNDS, d.background, DEFAULT_DESIGN.background),
    card: known(CARD_STYLES, d.card, DEFAULT_DESIGN.card), font: known(FONTS, d.font, DEFAULT_DESIGN.font), corners: known(CORNERS, d.corners, DEFAULT_DESIGN.corners),
    accent: safeColor(d.accent), backgroundImage: safeImage(d.backgroundImage), logo: safeImage(d.logo),
    organization: typeof d.organization === 'string' ? d.organization.slice(0, 80) : undefined, animate: d.animate !== false,
  };
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const mix = (hex: string, to: number, share: number) => `#${channels(hex).map((c) => Math.round(c + (to - c) * share).toString(16).padStart(2, '0')).join('')}`;

/** Adjusts a chosen color only as far as needed for links and labels to stay readable. */
export function legibleAccent(hex: string, surface: string, target = 4.5) {
  const to = luminance(surface) > 0.4 ? 0 : 255;
  for (let step = 0; step <= 20; step++) {
    const next = mix(hex, to, step / 20);
    if (contrast(next, surface) >= target) return next;
  }
  return mix(hex, to, 1);
}

const svgUrl = (body: string, w: number, h: number) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

/** Original background artwork, drawn faintly so charts and text stay easy to read. */
export function backgroundLayers(id: string, color: string): { image: string; size: string } {
  const a = (alpha: string) => `${color}${alpha}`;
  switch (id) {
    case 'gradient': return { image: `linear-gradient(165deg, ${a('2e')} 0%, ${a('00')} 58%)`, size: 'auto' };
    case 'aurora': return { image: `radial-gradient(44% 52% at 12% 8%, ${a('38')}, ${a('00')} 72%), radial-gradient(40% 48% at 92% 18%, ${a('24')}, ${a('00')} 72%), radial-gradient(50% 46% at 62% 100%, ${a('2c')}, ${a('00')} 72%)`, size: 'auto' };
    case 'dots': return { image: `radial-gradient(${a('40')} 1.3px, ${a('00')} 1.6px)`, size: '20px 20px' };
    case 'grid': return { image: `linear-gradient(${a('1e')} 1px, ${a('00')} 1px), linear-gradient(90deg, ${a('1e')} 1px, ${a('00')} 1px)`, size: '26px 26px' };
    case 'diagonal': return { image: `repeating-linear-gradient(135deg, ${a('1c')} 0 1.5px, ${a('00')} 1.5px 13px)`, size: 'auto' };
    case 'waves': return { image: svgUrl(`<g fill='none' stroke='${color}' stroke-opacity='.16' stroke-width='2'><path d='M0 30c40-26 80-26 120 0s80 26 120 0'/><path d='M0 70c40-26 80-26 120 0s80 26 120 0'/><path d='M0 110c40-26 80-26 120 0s80 26 120 0'/></g>`, 240, 120), size: '240px 120px' };
    case 'hexagons': return { image: svgUrl(`<path fill='none' stroke='${color}' stroke-opacity='.16' stroke-width='1.5' d='M28 2l26 15v30L28 62 2 47V17zM28 62v30M2 47l-26 15M54 47l26 15'/>`, 56, 92), size: '56px 92px' };
    case 'rings': return { image: svgUrl(`<g fill='none' stroke='${color}' stroke-opacity='.15' stroke-width='1.5'><circle cx='80' cy='80' r='22'/><circle cx='80' cy='80' r='44'/><circle cx='80' cy='80' r='66'/></g>`, 160, 160), size: '160px 160px' };
    case 'bars': return { image: `${svgUrl(`<g fill='${color}' fill-opacity='.13'>${[46, 74, 60, 104, 88, 132, 116, 160, 142, 190, 172, 220].map((h, i) => `<rect x='${i * 50 + 6}' y='${230 - h}' width='38' height='${h}' rx='5'/>`).join('')}</g>`, 600, 230)}`, size: '100% 230px' };
    default: return { image: 'none', size: 'auto' };
  }
}

export interface ResolvedDesign { design: ReportDesign; vars: Record<string, string>; className: string; series: string[] | null }

export function resolveDesign(raw: Partial<ReportDesign> | null | undefined, dark: boolean): ResolvedDesign {
  const design = cleanDesign(raw);
  const theme = THEMES.find((t) => t.id === design.theme)!;
  const font = FONTS.find((f) => f.id === design.font)!;
  const surface = dark ? '#1a1a19' : '#fcfcfb';
  const accent = legibleAccent(design.accent ?? (dark ? theme.accentDark : theme.accent), surface);
  const page = dark ? theme.pageDark : theme.page;
  const art = backgroundLayers(design.background, accent);
  const photo = design.backgroundImage;
  return {
    design,
    series: dark || design.accent ? (design.accent && !dark ? [accent, ...(theme.series ?? ['#d9541e', '#0f8a6d', '#b7791f', '#c0357a', '#6d3fc4']).filter((c) => c !== accent).slice(1)] : null) : theme.series,
    className: `look-${design.card}${design.animate ? ' animate' : ''}`,
    vars: {
      '--accent': accent, '--accent-hover': mix(accent, dark ? 255 : 0, 0.14), '--accent-soft': `color-mix(in srgb, ${accent} 14%, ${surface})`,
      '--on-accent': contrast('#ffffff', accent) >= 4.5 ? '#ffffff' : '#06121f', '--series-1': accent, '--page': page,
      '--radius': CORNERS.find((c) => c.id === design.corners)!.radius, '--font': font.body, '--font-head': font.head,
      '--design-image': photo ? `linear-gradient(${page}c9, ${page}c9), url("${photo}")` : art.image,
      '--design-size': photo ? 'cover' : art.size,
      '--design-position': design.background === 'bars' && !photo ? 'left bottom' : 'center',
      '--design-repeat': photo || design.background === 'bars' ? 'no-repeat' : 'repeat',
    },
  };
}

/** Starting sizes on the 12-column report page. */
export const ELEMENT_SIZE: Record<ElementKind, { w: number; h: number }> = { text: { w: 6, h: 3 }, shape: { w: 3, h: 4 }, icon: { w: 2, h: 5 }, image: { w: 4, h: 8 }, breakdown: { w: 4, h: 9 } };

interface CopyablePage<V extends { id: string }> { id: string; name: string; visuals: V[]; layout: { i: string }[]; elements?: PageElement[] }

/** Copies a page, giving every chart and element a new identity. */
export function clonePage<V extends { id: string }, P extends CopyablePage<V>>(page: P, nextId: () => string): P {
  const ids = new Map<string, string>();
  const fresh = (id: string) => { const n = nextId(); ids.set(id, n); return n; };
  const visuals = page.visuals.map((v) => ({ ...v, id: fresh(v.id) }));
  const elements = page.elements?.map((e) => ({ ...e, id: fresh(e.id) }));
  return { ...page, id: nextId(), name: `${page.name} copy`, visuals, elements, layout: page.layout.filter((l) => ids.has(l.i)).map((l) => ({ ...l, i: ids.get(l.i)! })) };
}
