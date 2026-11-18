import type { RawTable, LocaleOptions, Step } from '../core/types';
import type { ReportDoc } from '../core/report';

/** Saved work lives only in this browser (IndexedDB). Nothing is uploaded. */

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

const DB = 'statistical-report-workspace';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export const saveProject = async (p: ProjectRecord) => { try { await tx('readwrite', (s) => s.put(p)); } catch { /* storage may be unavailable or full */ } };
export const loadProject = (id: string) => tx<ProjectRecord | undefined>('readonly', (s) => s.get(id));
export const deleteProject = (id: string) => tx('readwrite', (s) => s.delete(id));

export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const all = await tx<ProjectRecord[]>('readonly', (s) => s.getAll());
    return all.map(({ id, name, updatedAt, rowCount, columnCount }) => ({ id, name, updatedAt, rowCount, columnCount })).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}
