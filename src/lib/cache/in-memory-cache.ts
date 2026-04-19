/**
 * InMemoryCache — a simple Map-backed CacheProvider with per-entry TTL.
 *
 * Expired entries are lazily evicted on access and periodically swept by an
 * optional background interval (disabled by default).
 *
 * This is intentionally lightweight so it can be swapped for Redis or another
 * backend without changing any consumer code.
 *
 * Linear: AR-47
 */

import type { CacheProvider } from './cache-provider';

interface CacheEntry<T> {
  value: T;
  /** Absolute expiration timestamp in milliseconds (Date.now() based). */
  expiresAt: number;
}

export interface InMemoryCacheOptions {
  /**
   * If > 0, a `setInterval` will run every `sweepIntervalMs` milliseconds to
   * purge expired entries. Set to 0 (default) to rely on lazy eviction only.
   */
  sweepIntervalMs?: number;
}

export class InMemoryCache implements CacheProvider {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: InMemoryCacheOptions = {}) {
    const { sweepIntervalMs = 0 } = options;

    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
      // Allow the Node process to exit even if the timer is still running.
      if (typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
        this.sweepTimer.unref();
      }
    }
  }

  // -------------------------------------------------------------------------
  // CacheProvider implementation
  // -------------------------------------------------------------------------

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Stop the background sweep timer (if running). */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Return the number of (possibly expired) entries currently in the map. */
  get size(): number {
    return this.store.size;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Remove all expired entries in one pass. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
