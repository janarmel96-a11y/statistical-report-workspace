// Generates the synthetic sample files in public/samples. All names and numbers are invented.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
mkdirSync(out, { recursive: true });

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const money = (v) => v.toFixed(2);

/* Retail sales, with planted errors the audit must find */
{
  const r = rng(20240611);
  const pick = (a, w) => { let x = r() * w.reduce((p, c) => p + c, 0); for (let i = 0; i < a.length; i++) { x -= w[i]; if (x <= 0) return a[i]; } return a[a.length - 1]; };
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const channels = ['Online', 'Retail', 'Partner'];
  const cats = { Electronics: [120, 480], Furniture: [85, 390], Apparel: [18, 75], Grocery: [6, 28], Sports: [25, 160] };
  const names = Object.keys(cats);
  const start = Date.UTC(2023, 0, 1);
  const days = Date.UTC(2025, 10, 18) - start;
  const rows = [];
  for (let i = 0; i < 1500; i++) {
    const t = start + Math.floor(r() ** 0.85 * days / 86400000) * 86400000;
    const m = new Date(t).getUTCMonth();
    if ((m === 10 || m === 11) ? false : r() < 0.2) { i--; continue; }
    const cat = pick(names, [3, 2, 4, 5, 2]);
    const [lo, hi] = cats[cat];
    const qty = 1 + Math.floor(r() * 6);
    const price = Math.round((lo + r() * (hi - lo)) * 100) / 100;
    const gross = Math.round(qty * price * 100) / 100;
    const discount = Math.round(gross * [0, 0, 0.05, 0.1, 0.15][Math.floor(r() * 5)] * 100) / 100;
    rows.push({ t, region: pick(regions, [5, 3, 4, 3, 2]), channel: pick(channels, [5, 4, 2]), cat, qty, price, gross, discount, net: Math.round((gross - discount) * 100) / 100, sat: Math.round((3.2 + r() * 1.8) * 10) / 10 });
  }
  rows.sort((a, b) => a.t - b.t);
  const lines = ['Order ID,Order Date,Region,Channel,Category,Quantity,Unit Price,Gross Sales,Discount,Net Sales,Satisfaction'];
  rows.forEach((x, i) => {
    let region = x.region; let gross = money(x.gross); let net = money(x.net); let qty = String(x.qty); let date = iso(x.t);
    if (i === 40) gross = money(x.gross + 100);            // wrong multiplication
    if (i === 212) net = money(x.net * 10);                // misplaced decimal
    if (i === 611) gross = '#REF!';                        // spreadsheet error
    if (i === 733) net = '';                               // missing result
    if (i === 905) gross = `"$${Number(gross).toLocaleString('en-US', { minimumFractionDigits: 2 })}"`;  // number stored as text
    if (i % 97 === 5) region = region.toUpperCase();       // inconsistent label
    if (i % 131 === 7) region = `${region} `;              // trailing space
    lines.push(`SO-${String(10000 + i)},${date},${region},${x.channel},${x.cat},${qty},${money(x.price)},${gross},${money(x.discount)},${net},${x.sat}`);
    if (i === 300 || i === 900) lines.push(`SO-${String(10000 + i)},${date},${region},${x.channel},${x.cat},${qty},${money(x.price)},${gross},${money(x.discount)},${net},${x.sat}`); // duplicate row
  });
  const sum = (f) => rows.reduce((s, x) => s + f(x), 0);
  lines.push(`,,Grand Total,,,${sum((x) => x.qty)},,${money(sum((x) => x.gross) + 250)},${money(sum((x) => x.discount))},${money(sum((x) => x.net))},`); // printed total is wrong
  writeFileSync(join(out, 'retail-sales.csv'), `${lines.join('\n')}\n`);
}

/* Service operations */
{
  const r = rng(77123);
  const teams = ['Billing', 'Technical', 'Accounts', 'Onboarding'];
  const prio = ['Low', 'Medium', 'High', 'Urgent'];
  const start = Date.UTC(2024, 0, 1);
  const lines = ['Ticket ID,Opened,Team,Priority,Agents Assigned,Resolution Hours,First Response Minutes,Satisfaction Score,Resolved'];
  for (let i = 0; i < 900; i++) {
    const t = start + Math.floor(r() * 680) * 86400000;
    const team = teams[Math.floor(r() * 4)];
    const p = Math.floor(r() ** 1.6 * 4);
    const base = [46, 28, 15, 6][p] * (team === 'Technical' ? 1.35 : 1);
    const hours = Math.max(0.5, base * (0.45 + r() * 1.2));
    const sat = Math.min(5, Math.max(1, 4.9 - hours / 34 + (r() - 0.5) * 1.2));
    lines.push(`T-${50000 + i},${iso(t)},${team},${prio[p]},${1 + Math.floor(r() * 3)},${hours.toFixed(1)},${Math.round(5 + r() * (60 - p * 13))},${sat.toFixed(1)},${r() < 0.93 ? 'Yes' : 'No'}`);
  }
  writeFileSync(join(out, 'service-operations.csv'), `${lines.join('\n')}\n`);
}
console.log('Samples written to public/samples');
