// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { RawTable, LocaleOptions, Step } from '../core/types';
import type { ReportDoc } from '../core/report';

/**
 * Saved work lives only in this browser and is encrypted with AES-256-GCM before it is stored.
 * The key is created on this device, cannot be exported, and is never sent anywhere.
 */

export interface CombineConfig { mode: 'single' | 'append' | 'join'; leftKey?: string; rightKey?: string }

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  rowCount: number;
  columnCount: number;
  raws: RawTable[];
  combine: CombineConfig;
  locale: LocaleOptions;
  steps: Step[];
  disabledFindings: string[];
  report: ReportDoc | null;
}

export type ProjectSummary = Pick<ProjectRecord, 'id' | 'name' | 'updatedAt' | 'rowCount' | 'columnCount'>;

interface Sealed { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }
interface StoredProject { id: string; updatedAt: number; meta: Sealed; body: Sealed }

const DB = 'statistical-report-workspace';
const STORE = 'projects';
const KEYS = 'keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!req.result.objectStoreNames.contains(KEYS)) req.result.createObjectStore(KEYS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function deviceKey(): Promise<CryptoKey> {
  const existing = await tx<CryptoKey | undefined>(KEYS, 'readonly', (s) => s.get('main'));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // add() fails if another tab created a key first, and that key is then used instead.
  await tx(KEYS, 'readwrite', (s) => s.add(key, 'main')).catch(() => undefined);
  return (await tx<CryptoKey>(KEYS, 'readonly', (s) => s.get('main')));
}

async function seal(value: unknown, key: CryptoKey): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv, data };
}

async function unseal<T>(s: Sealed, key: CryptoKey): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, key, s.data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

const summaryOf = ({ id, name, updatedAt, rowCount, columnCount }: ProjectRecord): ProjectSummary => ({ id, name, updatedAt, rowCount, columnCount });

async function sealRecord(p: ProjectRecord, key: CryptoKey): Promise<StoredProject> {
  return { id: p.id, updatedAt: p.updatedAt, meta: await seal(summaryOf(p), key), body: await seal(p, key) };
}

/** Reports are never written unencrypted. If encryption is unavailable, nothing is saved. */
export async function saveProject(p: ProjectRecord) {
  try {
    const stored = await sealRecord(p, await deviceKey());
    await tx(STORE, 'readwrite', (s) => s.put(stored));
  } catch { /* storage may be unavailable or full */ }
}

export async function loadProject(id: string): Promise<ProjectRecord | undefined> {
  const stored = await tx<StoredProject | ProjectRecord | undefined>(STORE, 'readonly', (s) => s.get(id));
  if (!stored) return undefined;
  if ('raws' in stored) return stored;
  return unseal<ProjectRecord>(stored.body, await deviceKey());
}

export const deleteProject = (id: string) => tx(STORE, 'readwrite', (s) => s.delete(id));

/** Removes every saved report and the encryption key from this browser. */
export function deleteAllProjects(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const key = await deviceKey();
    const all = await tx<(StoredProject | ProjectRecord)[]>(STORE, 'readonly', (s) => s.getAll());
    const out: ProjectSummary[] = [];
    for (const rec of all) {
      if ('raws' in rec) {
        // A report saved by an earlier version is encrypted the first time it is seen.
        const stored = await sealRecord(rec, key);
        await tx(STORE, 'readwrite', (s) => s.put(stored));
        out.push(summaryOf(rec));
      } else {
        try { out.push(await unseal<ProjectSummary>(rec.meta, key)); } catch { /* unreadable without its key */ }
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}
