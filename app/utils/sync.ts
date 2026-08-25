/**
 * Offline write queue — interface only (Phase 2).
 *
 * Drivers work in port yards, warehouse interiors and rail terminals where
 * connectivity disappears entirely. Every mutating operational endpoint already
 * accepts a client-generated event UUID as an idempotency key, so a queued
 * mutation can be replayed safely once connectivity returns.
 *
 * TODO(Phase 2): implement with Dexie (IndexedDB) —
 *  - persist each mutation with its event UUID, endpoint, payload and attempt count
 *  - flush FIFO on `online`, on app focus and via a periodic Background Sync task
 *  - retry with exponential backoff; surface permanent failures in the UI
 *  - reconcile server truth after each successful flush
 */

export interface QueuedMutation {
  /** Client-generated UUID; doubles as the idempotency key and the event id. */
  eventId: string
  endpoint: string
  method: 'POST' | 'PATCH' | 'DELETE'
  payload: unknown
  queuedAt: string
  attempts: number
  lastError?: string
}

export interface SyncQueue {
  enqueue(mutation: Omit<QueuedMutation, 'queuedAt' | 'attempts'>): Promise<void>
  pending(): Promise<QueuedMutation[]>
  flush(): Promise<{ flushed: number, failed: number }>
  clear(): Promise<void>
}

class NotImplementedSyncQueue implements SyncQueue {
  async enqueue() {
    throw new Error('Offline queue is not implemented yet (Phase 2).')
  }

  async pending() {
    return [] as QueuedMutation[]
  }

  async flush() {
    return { flushed: 0, failed: 0 }
  }

  async clear() {}
}

let queue: SyncQueue | undefined

export function useSyncQueue(): SyncQueue {
  if (!queue) queue = new NotImplementedSyncQueue()
  return queue
}
