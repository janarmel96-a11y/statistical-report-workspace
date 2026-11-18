import type { RawCell, RawTable } from '../core/types';

/** Layout analysis that turns positioned text into tables. Used for both digital PDFs and OCR output. */

export interface TextBox { str: string; x: number; y: number; w: number; h: number; conf?: number }

interface Seg { text: string; x0: number; x1: number; conf: number }
interface Line { y: number; h: number; segs: Seg[] }

const medianOf = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

function toLines(items: TextBox[]): Line[] {
  const boxes = items.filter((b) => b.str.trim());
  if (!boxes.length) return [];
  const mh = medianOf(boxes.map((b) => b.h)) || 10;
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: TextBox[][] = [];
  for (const b of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - b.y) < mh * 0.55) g.push(b); else groups.push([b]);
  }
  const gapLimit = Math.max(mh * 0.95, 5);
  return groups.map((g) => {
    const segs: Seg[] = [];
    for (const b of [...g].sort((p, q) => p.x - q.x)) {
      // A run of spaces inside one text item is a column gap.
      const parts = b.str.split(/\s{2,}/).filter((p) => p.trim());
      const charW = b.w / Math.max(1, b.str.length);
      let cursor = 0;
      for (const part of parts) {
        const at = b.str.indexOf(part, cursor);
        cursor = at + part.length;
        const x0 = b.x + at * charW;
        const x1 = x0 + part.length * charW;
        const last = segs[segs.length - 1];
        if (last && x0 - last.x1 <= gapLimit) {
          last.text += (x0 - last.x1 > mh * 0.15 ? ' ' : '') + part.trim();
          last.x1 = Math.max(last.x1, x1);
          last.conf = Math.min(last.conf, b.conf ?? 1);
        } else segs.push({ text: part.trim(), x0, x1, conf: b.conf ?? 1 });
      }
    }
    return { y: g[0].y, h: mh, segs };
  });
}

function columnsOf(lines: Line[]): [number, number][] {
  const counts = new Map<number, number>();
  lines.forEach((l) => counts.set(l.segs.length, (counts.get(l.segs.length) ?? 0) + 1));
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const basis = lines.filter((l) => l.segs.length === mode);
  const spans = basis.flatMap((l) => l.segs.map((s) => [s.x0, s.x1] as [number, number])).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]); else merged.push([...s]);
  }
  // Overlaps can collapse columns. Fall back to the positions on the most typical line.
  return merged.length >= mode ? merged : basis[0].segs.map((s) => [s.x0, s.x1]);
}

function assign(seg: Seg, cols: [number, number][]): number {
  let best = 0;
  let score = -Infinity;
  cols.forEach(([a, b], i) => {
    const overlap = Math.min(seg.x1, b) - Math.max(seg.x0, a);
    const center = -Math.abs((seg.x0 + seg.x1) / 2 - (a + b) / 2) / 1000;
    if (overlap + center > score) { score = overlap + center; best = i; }
  });
  return best;
}

export interface PageTable { page: number; headers: string[]; rows: string[][]; confidence: number; endsPage: boolean; startsPage: boolean }

export function tablesOnPage(items: TextBox[], page: number): PageTable[] {
  const lines = toLines(items);
  const blocks: Line[][] = [];
  let cur: Line[] = [];
  const flush = () => { if (cur.filter((l) => l.segs.length >= 2).length >= 2) blocks.push(cur); cur = []; };
  // Row spacing varies between documents, so a break is judged against this page's typical spacing.
  const typicalGap = medianOf(lines.slice(1).map((l, i) => l.y - lines[i].y));
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const farApart = prev && l.y - prev.y > Math.max(l.h * 3, typicalGap * 1.8);
    if (farApart) flush();
    if (l.segs.length >= 2) cur.push(l);
    else if (cur.length && lines[i + 1]?.segs.length >= 2 && !farApart && l.segs[0].text.length < 40) cur.push(l); // wrapped cell
    else flush();
  });
  flush();

  return blocks.map((block) => {
    const cols = columnsOf(block.filter((l) => l.segs.length >= 2));
    const grid: string[][] = [];
    let conf = 0;
    let n = 0;
    for (const l of block) {
      const row = new Array<string>(cols.length).fill('');
      for (const s of l.segs) {
        const c = assign(s, cols);
        row[c] = row[c] ? `${row[c]} ${s.text}` : s.text;
        conf += s.conf; n++;
      }
      if (l.segs.length === 1 && grid.length) {
        const c = assign(l.segs[0], cols);
        grid[grid.length - 1][c] = `${grid[grid.length - 1][c]} ${l.segs[0].text}`.trim();
      } else grid.push(row);
    }
    const filled = grid.flat().filter(Boolean).length / Math.max(1, grid.length * cols.length);
    const allLines = lines;
    return {
      page,
      headers: grid[0],
      rows: grid.slice(1),
      confidence: Math.min(1, (conf / Math.max(1, n)) * (0.6 + 0.4 * filled)),
      startsPage: allLines.indexOf(block[0]) <= 2,
      endsPage: allLines.indexOf(block[block.length - 1]) >= allLines.length - 3,
    };
  });
}

const norm = (r: string[]) => r.join('|').toLowerCase().replace(/\s+/g, '');
const numericShare = (r: string[]) => r.filter((c) => /^[-($€£¥₱₹]*\d[\d,.]*[)%]?$/.test(c)).length / Math.max(1, r.filter(Boolean).length);

/** Joins a table that continues on the next page, removing a repeated header when present. */
export function joinPages(tables: PageTable[]): PageTable[] {
  const out: PageTable[] = [];
  for (const t of tables) {
    const prev = out[out.length - 1];
    const continues = prev && t.page === prev.page + 1 && prev.endsPage && t.startsPage && prev.headers.length === t.headers.length;
    if (continues && norm(prev.headers) === norm(t.headers)) {
      t.rows.forEach((r) => prev.rows.push(r)); prev.page = t.page; prev.endsPage = t.endsPage;
    } else if (continues && numericShare(t.headers) > 0) {
      prev.rows.push(t.headers, ...t.rows); prev.page = t.page; prev.endsPage = t.endsPage;
    } else out.push({ ...t, rows: [...t.rows] });
  }
  return out;
}

export function pageTablesToRaw(tables: PageTable[], source: string, ocr: boolean): RawTable[] {
  const name = source.replace(/\.[^.]+$/, '');
  return joinPages(tables).map((t, i) => ({
    name: `${name} (table ${i + 1})`,
    source,
    headers: t.headers,
    rows: t.rows.map((r) => r.map((c): RawCell => (c === '' ? null : c))),
    confidence: t.confidence,
    note: ocr ? 'Read with OCR. Check the values against the original document.' : undefined,
  }));
}
