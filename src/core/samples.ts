// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.

/** The sample data on the home page, ordered from the simplest to the most advanced. All names and numbers are invented. */

export type SampleLevel = 1 | 2 | 3 | 4;

export interface Sample {
  id: string;
  name: string;
  files: string[];
  level: SampleLevel;
  meta: string;
  /** What this sample teaches. */
  learn: string;
}

export const LEVEL_NAMES: Record<SampleLevel, string> = { 1: 'Starter', 2: 'Basic', 3: 'Intermediate', 4: 'Advanced' };

export const SAMPLES: Sample[] = [
  { id: 'budget', name: 'Monthly budget', files: ['monthly-budget.csv'], level: 1, meta: '12 months · 4 columns', learn: 'Totals, planned against actual, and your first charts.' },
  { id: 'cafe', name: 'Café daily sales', files: ['cafe-daily-sales.csv'], level: 2, meta: '2 years · 731 days', learn: 'Trends over time, weekday and weather patterns, and a forecast.' },
  { id: 'service', name: 'Service operations', files: ['service-operations.csv'], level: 2, meta: '2 years · 900 tickets', learn: 'Compare teams and priorities using response times and satisfaction.' },
  { id: 'retail', name: 'Retail sales', files: ['retail-sales.csv'], level: 3, meta: '3 years · 1,500 orders', learn: 'Includes planted calculation errors, so you can watch them get fixed.' },
  { id: 'branches', name: 'Branch sales, 3 files', files: ['branch-sales-q1-2025.csv', 'branch-sales-q2-2025.csv', 'branch-sales-q3-2025.csv'], level: 3, meta: '3 quarterly files · 1,080 sales', learn: 'Files with the same headers are combined into one report.' },
  { id: 'supply', name: 'Supply chain', files: ['supply-chain.csv'], level: 4, meta: '3 years · 3,000 orders · 16 columns', learn: 'Blanks, wrong totals, two dates, costs and margins, and what makes deliveries late.' },
];

/** The guide marks a sample as opened with this id. */
export const sampleGuideId = (s: Sample) => `sample-${s.id}`;
