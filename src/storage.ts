import { openDB, type IDBPDatabase } from 'idb';
import type { Annotation, Labels } from './contracts';

export interface QueuedItem {
  labels: Labels;
  version: number;
  revision: number;
  saveState: 'saved' | 'saving' | 'unsynced' | 'error' | 'conflict';
  updatedAt?: string;
  mutationId?: string;
  remote?: Annotation;
  error?: string;
  terminal?: boolean;
}

const DEFAULT_DATABASE = 'kisti-policy-review-local-v1';
const itemKey = (ownerId: string, assignmentId: string, itemId: string) => JSON.stringify([ownerId, assignmentId, itemId]);
const prefix = (ownerId: string, assignmentId: string) => JSON.stringify([ownerId, assignmentId]).slice(0, -1) + ',';

export class IndexedDbQueue {
  private readonly databaseName: string;
  constructor(options: { databaseName?: string } = {}) { this.databaseName = options.databaseName ?? DEFAULT_DATABASE; }

  private database(): Promise<IDBPDatabase> {
    return openDB(this.databaseName, 1, {
      upgrade(db) {
        db.createObjectStore('items');
        db.createObjectStore('documents');
      },
    });
  }

  async put(ownerId: string, assignmentId: string, itemId: string, value: QueuedItem): Promise<void> {
    const db = await this.database();
    try { await db.put('items', structuredClone(value), itemKey(ownerId, assignmentId, itemId)); }
    finally { db.close(); }
  }

  async getAll(ownerId: string, assignmentId: string): Promise<Record<string, QueuedItem>> {
    const db = await this.database();
    try {
      const result: Record<string, QueuedItem> = {};
      const tx = db.transaction('items');
      let cursor = await tx.store.openCursor();
      while (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix(ownerId, assignmentId))) {
          const [, , itemId] = JSON.parse(cursor.key) as [string, string, string];
          result[itemId] = cursor.value as QueuedItem;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      return result;
    } finally { db.close(); }
  }

  async saveDocument(ownerId: string, assignmentId: string, value: unknown): Promise<void> {
    const db = await this.database();
    try { await db.put('documents', value, JSON.stringify([ownerId, assignmentId])); }
    finally { db.close(); }
  }

  async loadDocument(ownerId: string, assignmentId: string): Promise<unknown | null> {
    const db = await this.database();
    try { return (await db.get('documents', JSON.stringify([ownerId, assignmentId]))) ?? null; }
    finally { db.close(); }
  }
}

const defaultQueue = new IndexedDbQueue();
export const saveLocalDocument = (ownerId: string, assignmentId: string, value: unknown): Promise<void> =>
  defaultQueue.saveDocument(ownerId, assignmentId, value);
export const loadLocalDocument = (ownerId: string, assignmentId: string): Promise<unknown | null> =>
  defaultQueue.loadDocument(ownerId, assignmentId);
