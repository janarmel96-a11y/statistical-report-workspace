// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.

/** Picks a meaningful icon from the words in a title, column name, or group label. */

export type IconKey =
  | 'female' | 'male' | 'sex' | 'birthday' | 'age' | 'house' | 'map' | 'city' | 'location' | 'calendar' | 'consent' | 'marital'
  | 'health' | 'patient' | 'status' | 'category' | 'money' | 'quantity' | 'score' | 'staff' | 'education' | 'phone' | 'records' | 'chart';

const RULES: [IconKey, RegExp][] = [
  ['female', /\b(females?|wom[ae]n|girls?)\b/i],
  ['male', /\b(males?|m[ae]n|boys?)\b/i],
  ['sex', /\b(sex|gender)\b/i],
  ['birthday', /\b(birth|birthdays?|dob)\b/i],
  ['age', /\bages?\b/i],
  ['house', /\b(address|home|house|residence|purok|sitio|street)\b/i],
  ['map', /\b(country|region|province)\b/i],
  ['city', /\b(municipal\w*|city|cities|towns?)\b/i],
  ['location', /\b(barangays?|brgy|district|village|location|areas?|place|zone)\b/i],
  ['marital', /\b(civil status|marital|married|single|widowed)\b/i],
  ['consent', /\b(consent|approved?|agreement)\b/i],
  ['health', /\b(diagnos\w*|discharge|disease|illness|medical|medicine|clinic\w*|causes?|treatment|health|ward|services?|surgery|pediatrics)\b/i],
  ['patient', /\b(patients?|clients?|cases?)\b/i],
  ['status', /\b(status|stage)\b/i],
  ['category', /\b(classification|class|categor(y|ies)|types?|groups?|segments?|channels?)\b/i],
  ['money', /\b(sales|revenue|amount|income|profit|cost|expense|price|budget|payment|fee|salary|discount)\b/i],
  ['quantity', /\b(qty|quantity|units?|stock|volume)\b/i],
  ['score', /\b(score|rating|satisfaction)\b/i],
  ['staff', /\b(workers?|staff|employees?|team|agents?)\b/i],
  ['education', /\b(education|school|grade)\b/i],
  ['phone', /\b(contact|phone|mobile)\b/i],
  ['calendar', /\b(date|time|timestamp|months?|years?|quarters?|weeks?|days?|period)\b/i],
  ['records', /\b(records?|total|count|rows?)\b/i],
];

export const iconFor = (text: string): IconKey => RULES.find(([, r]) => r.test(text))?.[0] ?? 'chart';

/** Each meaning keeps one color across the report, and is always shown beside its written label. */
export const ICON_TONE: Record<IconKey, string> = {
  female: '#be2f6b', male: '#2563c9', sex: '#6d3fc4', birthday: '#c2410c', age: '#b7791f', house: '#0f8a6d', map: '#0f766e', city: '#0b6aa8', location: '#0f8a6d',
  calendar: '#6d3fc4', consent: '#0f8a6d', marital: '#be2f6b', health: '#c8323c', patient: '#0b6aa8', status: '#b7791f', category: '#6d3fc4', money: '#0f7a60',
  quantity: '#a16207', score: '#b7791f', staff: '#334e68', education: '#2563c9', phone: '#0f766e', records: '#1c5cab', chart: '#1c5cab',
};

export const ICON_CHOICES: { key: IconKey; name: string }[] = [
  { key: 'female', name: 'Female' }, { key: 'male', name: 'Male' }, { key: 'sex', name: 'People' }, { key: 'age', name: 'Age' }, { key: 'birthday', name: 'Birthday' },
  { key: 'house', name: 'Address' }, { key: 'location', name: 'Location' }, { key: 'city', name: 'City' }, { key: 'map', name: 'Map' }, { key: 'health', name: 'Health' },
  { key: 'patient', name: 'Patient' }, { key: 'consent', name: 'Approved' }, { key: 'marital', name: 'Family' }, { key: 'calendar', name: 'Calendar' }, { key: 'money', name: 'Money' },
  { key: 'score', name: 'Rating' }, { key: 'staff', name: 'Staff' }, { key: 'education', name: 'Education' }, { key: 'phone', name: 'Phone' }, { key: 'records', name: 'Records' },
];
