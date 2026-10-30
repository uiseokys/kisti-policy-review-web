import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Annotation, Labels, SaveCommand, SaveResult, SyncTransport } from '../src/contracts';
import { IndexedDbQueue, loadLocalDocument, saveLocalDocument } from '../src/storage';
import { SyncEngine } from '../src/sync';

const assignmentId = 'a1';
const itemId = 'i1';
const labels = (note: string): Labels => ({ note });
const annotation = (command: SaveCommand, version: number): Annotation => ({
  assignmentId: command.assignmentId, itemId: command.itemId, reviewerId: 'owner',
  labels: structuredClone(command.labels), version, updatedAt: `2026-10-30T00:00:0${version}Z`,
  mutationId: command.mutationId,
});

class CasTransport implements SyncTransport {
  rows = new Map<string, Annotation>();
  mutations = new Map<string, Annotation>();
  calls: SaveCommand[] = [];
  failures = 0;
  gate?: Promise<void>;
  result?: SaveResult;
  async load(assignment: string): Promise<Annotation[]> {
    return [...this.rows.values()].filter(row => row.assignmentId === assignment).map(row => structuredClone(row));
  }
  async save(command: SaveCommand): Promise<SaveResult> {
    this.calls.push(structuredClone(command));
    if (this.gate) await this.gate;
    if (this.failures-- > 0) throw new Error('network down');
    if (this.result) return this.result;
    const duplicate = this.mutations.get(command.mutationId);
    if (duplicate) return { ok: true, annotation: structuredClone(duplicate) };
    const current = this.rows.get(command.itemId);
    if ((current?.version ?? 0) !== command.expectedVersion) return { ok: false, type: 'conflict', remote: structuredClone(current!) };
    const saved = annotation(command, (current?.version ?? 0) + 1);
    this.rows.set(command.itemId, saved);
    this.mutations.set(command.mutationId, saved);
    return { ok: true, annotation: structuredClone(saved) };
  }
}

const db = 'sync-test';
const engine = (ownerId: string, transport: SyncTransport, debounceMs = 0) =>
  new SyncEngine({ ownerId, assignmentId, transport, debounceMs, store: new IndexedDbQueue({ databaseName: db }) });

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('durable sync', () => {
  it('keeps owners and assignments isolated in IndexedDB', async () => {
    const store = new IndexedDbQueue({ databaseName: db });
    await store.put('alice', 'a1', itemId, { labels: labels('alice'), version: 0, revision: 1, saveState: 'unsynced', mutationId: 'ma' });
    await store.put('bob', 'a1', itemId, { labels: labels('bob'), version: 0, revision: 1, saveState: 'unsynced', mutationId: 'mb' });
    await store.put('alice', 'a2', itemId, { labels: labels('other assignment'), version: 0, revision: 1, saveState: 'unsynced', mutationId: 'mc' });
    expect((await store.getAll('alice', 'a1'))[itemId].labels).toEqual(labels('alice'));
    expect((await store.getAll('bob', 'a1'))[itemId].labels).toEqual(labels('bob'));
    expect((await store.getAll('alice', 'a2'))[itemId].labels).toEqual(labels('other assignment'));
  });

  it('persists a draft before edit resolves and syncs it after offline reload', async () => {
    const transport = new CasTransport();
    const first = engine('alice', transport);
    first.setOnline(false);
    await first.start();
    await first.edit(itemId, labels('offline'));
    expect(first.getSnapshot().records[itemId]).toMatchObject({ labels: labels('offline'), saveState: 'unsynced' });
    expect(transport.calls).toHaveLength(0);
    first.stop();
    const second = engine('alice', transport);
    second.setOnline(false);
    await second.start();
    expect(second.getSnapshot().records[itemId].labels).toEqual(labels('offline'));
    second.setOnline(true);
    await second.flush();
    expect(second.getSnapshot()).toMatchObject({ pending: 0, records: { [itemId]: { saveState: 'saved', version: 1 } } });
    expect(transport.rows.get(itemId)?.labels).toEqual(labels('offline'));
    second.stop();
  });

  it('reuses a mutation ID after failure and accepts a duplicate server ACK', async () => {
    const transport = new CasTransport();
    transport.failures = 1;
    const first = engine('alice', transport, 60_000);
    await first.start();
    await first.edit(itemId, labels('retry'));
    await first.flush();
    expect(first.getSnapshot().records[itemId].saveState).toBe('error');
    const id = transport.calls[0].mutationId;
    // The server committed, but its response was lost.
    const committed = annotation(transport.calls[0], 1);
    transport.rows.set(itemId, committed);
    transport.mutations.set(id, committed);
    first.stop();
    const second = engine('alice', transport, 60_000);
    await second.start();
    await second.flush();
    expect(transport.calls.at(-1)?.mutationId).toBe(id);
    expect(second.getSnapshot().records[itemId].saveState).toBe('saved');
    expect(second.getSnapshot().records[itemId].version).toBe(1);
    second.stop();
  });

  it('retains a stale device draft and requires explicit conflict resolution', async () => {
    const transport = new CasTransport();
    const a = engine('alice', transport, 60_000);
    const b = engine('alice', transport, 60_000);
    await a.start(); await b.start();
    await a.edit(itemId, labels('device A')); await a.flush();
    await b.edit(itemId, labels('device B')); await b.flush();
    expect(b.getSnapshot().records[itemId]).toMatchObject({ saveState: 'conflict', labels: labels('device B'), remote: { labels: labels('device A'), version: 1 } });
    await b.resolve(itemId, 'local', labels('merged')); await b.flush();
    expect(transport.rows.get(itemId)).toMatchObject({ labels: labels('merged'), version: 2 });
    b.stop(); a.stop();
  });

  it('keeps edits made during an in-flight save pending and sends them at the new version', async () => {
    const transport = new CasTransport();
    let release!: () => void;
    transport.gate = new Promise<void>(resolve => { release = resolve; });
    const sync = engine('alice', transport, 60_000);
    await sync.start();
    await sync.edit(itemId, labels('first'));
    const sending = sync.flush();
    await Promise.resolve();
    await sync.edit(itemId, labels('second'));
    expect(sync.getSnapshot().records[itemId].labels).toEqual(labels('second'));
    release(); await sending; await sync.flush();
    expect(transport.calls.map(call => [call.labels.note, call.expectedVersion])).toEqual([['first', 0], ['second', 1]]);
    expect(sync.getSnapshot().records[itemId]).toMatchObject({ saveState: 'saved', version: 2 });
    sync.stop();
  });

  it('never marks a failed save as saved and keeps terminal drafts without retry', async () => {
    const transport = new CasTransport();
    transport.result = { ok: false, type: 'forbidden', message: 'access denied' };
    const sync = engine('alice', transport, 60_000);
    await sync.start(); await sync.edit(itemId, labels('private')); await sync.flush();
    expect(sync.getSnapshot().records[itemId]).toMatchObject({ labels: labels('private'), saveState: 'error', error: 'access denied' });
    await sync.flush();
    expect(transport.calls).toHaveLength(1);
    expect((await new IndexedDbQueue({ databaseName: db }).getAll('alice', assignmentId))[itemId].labels).toEqual(labels('private'));
    sync.stop();
  });

  it('keeps forbidden drafts terminal across reload until explicit retry', async () => {
    const transport = new CasTransport();
    transport.result = { ok: false, type: 'forbidden', message: 'access denied' };
    const first = engine('alice', transport, 60_000);
    await first.start(); await first.edit(itemId, labels('private')); await first.flush();
    const original = transport.calls[0];
    first.stop();

    const second = engine('alice', transport, 60_000);
    await second.start(); await second.flush();
    expect(transport.calls).toHaveLength(1);
    expect(second.getSnapshot().records[itemId]).toMatchObject({ saveState: 'error', labels: labels('private') });

    transport.result = undefined;
    await second.retry(itemId);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]).toMatchObject({ mutationId: original.mutationId, expectedVersion: original.expectedVersion, labels: original.labels });
    expect(second.getSnapshot().records[itemId]).toMatchObject({ saveState: 'saved', version: 1 });
    second.stop();
  });

  it('does not clear a locked draft if explicit retry is still rejected', async () => {
    const transport = new CasTransport();
    transport.result = { ok: false, type: 'locked', message: 'session locked' };
    const sync = engine('alice', transport, 60_000);
    await sync.start(); await sync.edit(itemId, labels('draft')); await sync.flush();
    const original = transport.calls[0];
    await sync.retry(itemId);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]).toMatchObject({ mutationId: original.mutationId, expectedVersion: original.expectedVersion });
    expect(sync.getSnapshot().records[itemId]).toMatchObject({ labels: labels('draft'), saveState: 'error', error: 'session locked' });
    await sync.flush();
    expect(transport.calls).toHaveLength(2);
    sync.stop();
  });

  it('stores local source documents without mixing owners', async () => {
    await saveLocalDocument('alice', 'a1', { text: 'A' });
    await saveLocalDocument('bob', 'a1', { text: 'B' });
    expect(await loadLocalDocument('alice', 'a1')).toEqual({ text: 'A' });
    expect(await loadLocalDocument('bob', 'a1')).toEqual({ text: 'B' });
    expect(await loadLocalDocument('alice', 'a2')).toBeNull();
  });

  it('keeps the snapshot reference stable until state changes and notifies subscribers', async () => {
    const sync = engine('alice', new CasTransport(), 60_000);
    await sync.start();
    const initial = sync.getSnapshot();
    expect(sync.getSnapshot()).toBe(initial);
    let notifications = 0;
    const unsubscribe = sync.subscribe(() => { notifications++; });
    await sync.edit(itemId, labels('new'));
    expect(sync.getSnapshot()).not.toBe(initial);
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
    const before = notifications;
    await sync.flush();
    expect(notifications).toBe(before);
    sync.stop();
  });

  it('accepts server version when resolving a conflict in favor of the server', async () => {
    const transport = new CasTransport();
    const a = engine('alice', transport, 60_000);
    const b = engine('alice', transport, 60_000);
    await a.start(); await b.start();
    await a.edit(itemId, labels('remote')); await a.flush();
    await b.edit(itemId, labels('local')); await b.flush();
    await b.resolve(itemId, 'server');
    expect(b.getSnapshot().records[itemId]).toMatchObject({ labels: labels('remote'), version: 1, saveState: 'saved' });
    expect(b.getSnapshot().pending).toBe(0);
    b.stop(); a.stop();
  });

  it('leaves an in-flight mutation durable when stopped before its ACK', async () => {
    const transport = new CasTransport();
    let release!: () => void;
    transport.gate = new Promise<void>(resolve => { release = resolve; });
    const first = engine('alice', transport, 60_000);
    await first.start(); await first.edit(itemId, labels('durable'));
    const sending = first.flush();
    await Promise.resolve();
    first.stop(); release(); await sending;
    expect((await new IndexedDbQueue({ databaseName: db }).getAll('alice', assignmentId))[itemId].saveState).toBe('saving');
    const second = engine('alice', transport, 60_000);
    await second.start(); await second.flush();
    expect(second.getSnapshot().records[itemId].saveState).toBe('saved');
    second.stop();
  });

  it('persist waits for a delayed local write before allowing lock release', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    class DelayedStore extends IndexedDbQueue {
      override async put(...args: Parameters<IndexedDbQueue['put']>): Promise<void> {
        await gate;
        return super.put(...args);
      }
    }
    const store = new DelayedStore({ databaseName: db });
    const sync = new SyncEngine({ ownerId: 'alice', assignmentId, transport: new CasTransport(), store, debounceMs: 60_000 });
    sync.setOnline(false);
    await sync.start();
    const editing = sync.edit(itemId, labels('must persist'));
    let finished = false;
    const barrier = sync.persist().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await editing; await barrier;
    expect(finished).toBe(true);
    expect((await store.getAll('alice', assignmentId))[itemId].labels).toEqual(labels('must persist'));
    sync.stop();
  });

  it('persist rejects when a queued local write fails', async () => {
    class FailingStore extends IndexedDbQueue {
      override async put(): Promise<void> { throw new Error('quota exceeded'); }
    }
    const sync = new SyncEngine({
      ownerId: 'alice', assignmentId, transport: new CasTransport(),
      store: new FailingStore({ databaseName: db }), debounceMs: 60_000,
    });
    sync.setOnline(false);
    await sync.start();
    const editing = sync.edit(itemId, labels('must persist'));
    await expect(sync.persist()).rejects.toThrow('quota exceeded');
    await expect(editing).rejects.toThrow('quota exceeded');
    sync.stop();
  });

  it('does not persist a late server load after stop', async () => {
    const store = new IndexedDbQueue({ databaseName: db });
    await store.put('alice', assignmentId, itemId, { labels: labels('local'), version: 1, revision: 0, saveState: 'saved' });
    let loadStarted!: () => void;
    let release!: (rows: Annotation[]) => void;
    const started = new Promise<void>(resolve => { loadStarted = resolve; });
    const gate = new Promise<Annotation[]>(resolve => { release = resolve; });
    class DeferredLoad extends CasTransport {
      override load(): Promise<Annotation[]> { loadStarted(); return gate; }
    }
    const sync = new SyncEngine({ ownerId: 'alice', assignmentId, transport: new DeferredLoad(), store, debounceMs: 60_000 });
    const starting = sync.start();
    await started;
    sync.stop();
    release([annotation({ assignmentId, itemId, expectedVersion: 1, mutationId: 'remote', labels: labels('server') }, 2)]);
    await starting;
    expect((await store.getAll('alice', assignmentId))[itemId]).toMatchObject({ labels: labels('local'), version: 1 });
  });
});
