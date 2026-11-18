// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { CSSProperties } from 'react';
import {
  BadgeCheck, BarChart3, Briefcase, Building2, Cake, CalendarDays, ClipboardList, GraduationCap, HeartHandshake, HeartPulse, Hourglass, House, Map as MapIcon, MapPin,
  Mars, Package, Phone, Stethoscope, Star, Tag, Users, Venus, Wallet, Activity, type LucideIcon,
} from 'lucide-react';
import { ICON_TONE, iconFor, type IconKey } from '../core/fieldIcons';

const ICONS: Record<IconKey, LucideIcon> = {
  female: Venus, male: Mars, sex: Users, birthday: Cake, age: Hourglass, house: House, map: MapIcon, city: Building2, location: MapPin, calendar: CalendarDays,
  consent: BadgeCheck, marital: HeartHandshake, health: HeartPulse, patient: Stethoscope, status: Activity, category: Tag, money: Wallet, quantity: Package,
  score: Star, staff: Briefcase, education: GraduationCap, phone: Phone, records: ClipboardList, chart: BarChart3,
};

/** A colored icon badge. It is decorative, so the written label beside it carries the meaning. */
export function FieldIcon({ icon, text = '', size = 16, className = '' }: { icon?: IconKey; text?: string; size?: number; className?: string }) {
  const key = icon ?? iconFor(text);
  const Icon = ICONS[key] ?? BarChart3;
  return <span className={`field-badge ${className}`} data-icon={key} style={{ '--tone': ICON_TONE[key] ?? ICON_TONE.chart } as CSSProperties} aria-hidden="true"><Icon size={size} /></span>;
}
