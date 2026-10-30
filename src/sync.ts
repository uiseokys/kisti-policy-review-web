import type { Annotation, Labels, SaveCommand, SaveResult, SyncTransport } from './contracts';
import { IndexedDbQueue, type QueuedItem } from './storage';

export type ItemState = Pick<QueuedItem, 'labels' | 'version' | 'saveState' | 'updatedAt' | 'revision' | 'remote' | 'error'>;
export interface SyncSnapshot { records: Record<string, ItemState>; pending: number; }

type Options = {
  ownerId: string;
  assignmentId: string;
  transport: SyncTransport;
  store?: IndexedDbQueue;
  debounceMs?: number;
};

const pending = (item: QueuedItem) => item.saveState !== 'saved';
const savedItem = (row: Annotation, revision = 0): QueuedItem => ({
  labels: structuredClone(row.labels), version: row.version, revision,
  saveState: 'saved', updatedAt: row.updatedAt,
});

export class SyncEngine {
  private readonly store: IndexedDbQueue;
  private readonly debounceMs: number;
  private records: Record<string, QueuedItem> = {};
  private snapshot: SyncSnapshot = { records: {}, pending: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly attempts = new Map<string, number>();
  private online = true;
  private started = false;
  private stopped = false;

  constructor(private readonly options: Options) {
    this.store = options.store ?? new IndexedDbQueue();
    this.debounceMs = options.debounceMs ?? 750;
  }

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(): void {
    const records: Record<string, ItemState> = {};
    let count = 0;
    for (const [id, item] of Object.entries(this.records)) {
      records[id] = {
        labels: structuredClone(item.labels), version: item.version, revision: item.revision,
        saveState: item.saveState, updatedAt: item.updatedAt,
        remote: item.remote && structuredClone(item.remote), error: item.error,
      };
      if (pending(item)) count++;
    }
    this.snapshot = { records, pending: count };
    this.listeners.forEach(listener => listener());
  }

  private update(itemId: string, value: QueuedItem): Promise<void> {
    this.records = { ...this.records, [itemId]: value };
    this.publish();
    const prior = this.writes.get(itemId) ?? Promise.resolve();
    const write = prior.catch(() => undefined).then(() => this.store.put(this.options.ownerId, this.options.assignmentId, itemId, value));
    this.writes.set(itemId, write);
    return write;
  }

  async persist(): Promise<void> {
    while (true) {
      const queued = [...this.writes.entries()];
      await Promise.all(queued.map(([, write]) => write));
      if (queued.length === this.writes.size && queued.every(([id, write]) => this.writes.get(id) === write)) return;
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    const local = await this.store.getAll(this.options.ownerId, this.options.assignmentId);
    if (this.stopped) return;
    this.records = local;
    for (const [id, item] of Object.entries(this.records)) {
      if (this.stopped) return;
      if (item.saveState === 'saving') await this.update(id, { ...item, saveState: 'unsynced' });
    }
    if (this.stopped) return;
    this.publish();
    if (this.online) {
      try {
        const rows = await this.options.transport.load(this.options.assignmentId);
        if (this.stopped) return;
        for (const row of rows) {
          if (this.stopped) return;
          const local = this.records[row.itemId];
          if (!local || !pending(local)) {
            if (!local || row.version >= local.version) await this.update(row.itemId, savedItem(row, local?.revision ?? 0));
          }
        }
      } catch { /* Local drafts remain usable when the server cannot be reached. */ }
      if (this.stopped) return;
      for (const [id, item] of Object.entries(this.records)) if (pending(item) && !item.terminal && item.saveState !== 'conflict') this.schedule(id, 0);
    }
  }

  async edit(itemId: string, labels: Labels): Promise<void> {
    if (!this.started || this.stopped) throw new Error('SyncEngine must be started');
    const previous = this.records[itemId];
    const next: QueuedItem = {
      labels: structuredClone(labels), version: previous?.version ?? 0,
      revision: (previous?.revision ?? 0) + 1, saveState: 'unsynced',
      updatedAt: previous?.updatedAt, mutationId: crypto.randomUUID(),
    };
    await this.update(itemId, next);
    this.attempts.delete(itemId);
    this.schedule(itemId, this.debounceMs);
  }

  private schedule(itemId: string, delay: number): void {
    const old = this.timers.get(itemId);
    if (old) clearTimeout(old);
    this.timers.delete(itemId);
    if (!this.online || this.stopped || !this.started) return;
    const timer = setTimeout(() => {
      this.timers.delete(itemId);
      void this.flush(itemId);
    }, delay);
    this.timers.set(itemId, timer);
  }

  async flush(itemId?: string): Promise<void> {
    if (!this.online || !this.started || this.stopped) return;
    const ids = itemId ? [itemId] : Object.keys(this.records);
    await Promise.all(ids.map(id => {
      const timer = this.timers.get(id);
      if (timer) clearTimeout(timer);
      this.timers.delete(id);
      return this.drain(id);
    }));
  }

  async retry(itemId: string): Promise<void> {
    if (!this.started || this.stopped) throw new Error('SyncEngine must be started');
    const item = this.records[itemId];
    if (!item || item.saveState !== 'error') throw new Error('No failed save to retry');
    await this.update(itemId, { ...item, saveState: 'unsynced', error: undefined, terminal: false });
    this.attempts.delete(itemId);
    if (this.online) await this.flush(itemId);
  }

  private drain(itemId: string): Promise<void> {
    const existing = this.flights.get(itemId);
    if (existing) return existing;
    const flight = this.sendPending(itemId).finally(() => { this.flights.delete(itemId); });
    this.flights.set(itemId, flight);
    return flight;
  }

  private async sendPending(itemId: string): Promise<void> {
    while (this.online && !this.stopped) {
      const item = this.records[itemId];
      if (!item || !pending(item) || item.saveState === 'conflict' || item.terminal) return;
      const mutationId = item.mutationId ?? crypto.randomUUID();
      const command: SaveCommand = {
        assignmentId: this.options.assignmentId, itemId,
        expectedVersion: item.version, mutationId, labels: structuredClone(item.labels),
      };
      await this.update(itemId, { ...item, mutationId, saveState: 'saving', error: undefined });
      if (this.stopped) return;
      let result: SaveResult;
      try { result = await this.options.transport.save(command); }
      catch (error) { result = { ok: false, type: 'error', message: error instanceof Error ? error.message : String(error) }; }
      if (this.stopped) return;
      const current = this.records[itemId];
      if (!current) return;
      if (result.ok) {
        this.attempts.delete(itemId);
        if (current.revision === item.revision) {
          await this.update(itemId, savedItem(result.annotation, current.revision));
          return;
        }
        await this.update(itemId, { ...current, version: result.annotation.version, updatedAt: result.annotation.updatedAt, saveState: 'unsynced' });
        continue;
      }
      if (result.type === 'conflict') {
        await this.update(itemId, { ...current, saveState: 'conflict', remote: structuredClone(result.remote), error: undefined });
        return;
      }
      if (current.revision !== item.revision) {
        if (result.type === 'forbidden' || result.type === 'locked') {
          await this.update(itemId, { ...current, saveState: 'error', error: result.message, terminal: true });
          return;
        }
        continue;
      }
      const terminal = result.type === 'forbidden' || result.type === 'locked';
      await this.update(itemId, { ...current, saveState: 'error', error: result.message, terminal });
      if (!terminal && this.online) {
        const attempt = (this.attempts.get(itemId) ?? 0) + 1;
        this.attempts.set(itemId, attempt);
        this.schedule(itemId, Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5)));
      }
      return;
    }
  }

  async resolve(itemId: string, choice: 'server' | 'local', mergedLabels?: Labels): Promise<void> {
    const item = this.records[itemId];
    if (!item || item.saveState !== 'conflict' || !item.remote) throw new Error('No conflict to resolve');
    if (choice === 'server') {
      await this.update(itemId, savedItem(item.remote, item.revision + 1));
      return;
    }
    await this.update(itemId, {
      labels: structuredClone(mergedLabels ?? item.labels), version: item.remote.version,
      updatedAt: item.remote.updatedAt, revision: item.revision + 1,
      saveState: 'unsynced', mutationId: crypto.randomUUID(),
    });
    this.schedule(itemId, this.debounceMs);
  }

  setOnline(value: boolean): void {
    this.online = value;
    if (!value) {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
    } else if (this.started && !this.stopped) {
      void this.flush();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }
}
