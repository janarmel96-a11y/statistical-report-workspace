// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
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
/* Level 1. Monthly budget: four clean columns, the simplest possible report */
{
  const r = rng(1201);
  const cats = [['Rent', 15000, 0], ['Food', 9000, 0.12], ['Transport', 3500, 0.2], ['Utilities', 4200, 0.12], ['Savings', 6000, 0.25], ['Leisure', 2500, 0.3]];
  const lines = ['Month,Category,Planned,Actual'];
  for (let m = 0; m < 12; m++) {
    for (const [name, plan, swing] of cats) {
      let season = 1;
      if (name === 'Utilities') season = 1 + 0.28 * Math.max(0, Math.cos(((m - 4) / 12) * 2 * Math.PI)); // hot months
      if (name === 'Food' && m === 11) season = 1.3;
      if (name === 'Leisure' && (m === 11 || m === 3)) season = 1.7;
      if (name === 'Savings' && m === 11) season = 0.6;
      const actual = Math.round((plan * season * (1 + (r() - 0.45) * 2 * swing)) / 10) * 10;
      lines.push(`${iso(Date.UTC(2025, m, 1))},${name},${plan},${actual}`);
    }
  }
  writeFileSync(join(out, 'monthly-budget.csv'), `${lines.join('\n')}\n`);
}

/* Level 2. Cafe daily sales: two years of days with weekday, weather, and seasonal patterns */
{
  const r = rng(3141);
  const start = Date.UTC(2024, 0, 1);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const lines = ['Date,Weekday,Weather,Customers,Cups Sold,Revenue'];
  for (let d = 0; d < 731; d++) {
    const t = start + d * 86400000;
    const day = new Date(t).getUTCDay();
    const m = new Date(t).getUTCMonth();
    const wet = m >= 5 && m <= 9 ? 0.45 : 0.12;
    const x = r();
    const weather = x < wet ? 'Rainy' : x < wet + 0.3 ? 'Cloudy' : 'Sunny';
    const growth = 1 + (d / 731) * 0.35;
    const week = day === 0 || day === 6 ? 1.35 : day === 5 ? 1.15 : 1;
    const wx = weather === 'Rainy' ? 0.78 : weather === 'Cloudy' ? 0.95 : 1.05;
    const season = 1 + 0.12 * Math.cos(((m - 11) / 12) * 2 * Math.PI);
    const customers = Math.round(120 * growth * week * wx * season * (0.88 + r() * 0.24));
    const cups = Math.round(customers * (1.25 + r() * 0.3));
    lines.push(`${iso(t)},${weekdays[day]},${weather},${customers},${cups},${money(cups * (118 + r() * 14))}`);
  }
  writeFileSync(join(out, 'cafe-daily-sales.csv'), `${lines.join('\n')}\n`);
}

/* Level 3. Branch sales: three quarterly files with the same headers, to be combined into one report */
{
  const r = rng(4455);
  const branches = ['Downtown', 'Harbor', 'Uptown', 'Airport'];
  const products = { Laptop: 42000, Tablet: 18500, Phone: 24000, Headset: 3200, Monitor: 9800 };
  const names = Object.keys(products);
  let id = 70000;
  for (let q = 0; q < 3; q++) {
    const lines = ['Sale ID,Sale Date,Branch,Product,Units,Unit Price,Sales'];
    const rows = [];
    for (let i = 0; i < 360; i++) {
      const t = Date.UTC(2025, q * 3, 1) + Math.floor(r() * 90) * 86400000;
      const branch = branches[Math.floor(r() ** (q === 2 ? 0.8 : 1.2) * 4)];
      const product = names[Math.floor(r() * names.length)];
      const units = 1 + Math.floor(r() * (product === 'Headset' ? 8 : 4));
      const price = Math.round(products[product] * (0.92 + r() * 0.16));
      rows.push({ t, branch, product, units, price });
    }
    rows.sort((a, b) => a.t - b.t).forEach((x) => lines.push(`S-${id++},${iso(x.t)},${x.branch},${x.product},${x.units},${x.price},${x.units * x.price}`));
    writeFileSync(join(out, `branch-sales-q${q + 1}-2025.csv`), `${lines.join('\n')}\n`);
  }
}

/* Level 4. Supply chain: 16 columns, two dates, blanks, costs and margins, and planted errors */
{
  const r = rng(90210);
  const pick = (a, w) => { let x = r() * w.reduce((p, c) => p + c, 0); for (let i = 0; i < a.length; i++) { x -= w[i]; if (x <= 0) return a[i]; } return a[a.length - 1]; };
  const warehouses = [['Northgate', 'North'], ['Riverside', 'North'], ['Eastport', 'East'], ['Westfield', 'West'], ['Lakeside', 'South']];
  const suppliers = [['Apex Supply', 3], ['BlueLine Traders', 5], ['Crestwood Goods', 8], ['Delta Parts', 6], ['Evergreen Co.', 11]];
  const catalog = [
    ['Electronics', 'Router', 900, 1400, 1.35], ['Electronics', 'Monitor', 4200, 6100, 1.3], ['Electronics', 'Keyboard', 450, 800, 1.45],
    ['Office', 'Paper Ream', 180, 240, 1.25], ['Office', 'Printer Ink', 650, 900, 1.6], ['Office', 'Desk Chair', 2500, 4200, 1.4],
    ['Cleaning', 'Disinfectant', 120, 190, 1.5], ['Cleaning', 'Paper Towels', 90, 140, 1.45],
    ['Food', 'Coffee Beans', 380, 520, 1.55], ['Food', 'Bottled Water', 15, 22, 1.6],
  ];
  const start = Date.UTC(2023, 0, 1);
  const days = Date.UTC(2025, 11, 31) - start;
  const rows = [];
  for (let i = 0; i < 3000; i++) {
    const t = start + Math.floor(r() ** 0.9 * days / 86400000) * 86400000;
    const [wh, region] = pick(warehouses, [5, 3, 4, 3, 2]);
    const [supplier, base] = pick(suppliers, [5, 4, 3, 3, 2]);
    const [cat, product, lo, hi, markup] = catalog[Math.floor(r() * catalog.length)];
    const units = Math.max(1, Math.round((product === 'Bottled Water' || product === 'Paper Towels' ? 120 : product === 'Monitor' || product === 'Desk Chair' ? 6 : 30) * (0.4 + r() * 1.2)));
    const cost = Math.round((lo + r() * (hi - lo)) * 100) / 100;
    const price = Math.round(cost * markup * (0.95 + r() * 0.1) * 100) / 100;
    const lead = Math.max(1, Math.round(base * (0.6 + r() * 0.9) + (new Date(t).getUTCMonth() === 11 ? 3 : 0)));
    const rating = Math.min(5, Math.max(1, 4.9 - lead * 0.16 + (r() - 0.5) * 1.1));
    rows.push({ t, wh, region, supplier, cat, product, units, cost, price, lead, rating: r() < 0.11 ? '' : rating.toFixed(1) });
  }
  rows.sort((a, b) => a.t - b.t);
  const lines = ['Order ID,Order Date,Delivery Date,Region,Warehouse,Supplier,Category,Product,Units,Unit Cost,Unit Price,Revenue,Cost,Lead Time (Days),On Time,Customer Rating'];
  rows.forEach((x, i) => {
    let region = x.region; let revenue = money(x.units * x.price); let units = String(x.units);
    if (i % 173 === 11) revenue = money(x.units * x.price * 1.1);   // wrong multiplication
    if (i === 1500) revenue = money(x.units * x.price * 100);        // misplaced decimal
    if (i === 2222) revenue = '#VALUE!';                             // spreadsheet error
    if (i === 2600) units = '';                                      // missing value
    if (i % 89 === 3) region = region.toLowerCase();                 // inconsistent label
    const line = `PO-${30000 + i},${iso(x.t)},${iso(x.t + x.lead * 86400000)},${region},${x.wh},${x.supplier},${x.cat},${x.product},${units},${money(x.cost)},${money(x.price)},${revenue},${money(x.units * x.cost)},${x.lead},${x.lead <= 7 ? 'Yes' : 'No'},${x.rating}`;
    lines.push(line);
    if (i === 999 || i === 2001) lines.push(line);                   // duplicate row
  });
  writeFileSync(join(out, 'supply-chain.csv'), `${lines.join('\n')}\n`);
}
console.log('Samples written to public/samples');
