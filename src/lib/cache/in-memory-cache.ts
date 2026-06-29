/**
 * InMemoryCache — a simple Map-backed CacheProvider with per-entry TTL.
 *
 * Expired entries are lazily evicted on access and periodically swept by an
 * optional background interval (disabled by default).
 * The cache also enforces an LRU max-entry cap so unique-symbol traffic cannot
 * grow process memory without bound.
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
  /** Maximum live entries retained before least-recently-used eviction. */
  maxEntries?: number;
  /** Emit a warning once the cache reaches this fraction of capacity. */
  warningThreshold?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_WARNING_THRESHOLD = 0.8;

export class InMemoryCache implements CacheProvider {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;
  private readonly warningThreshold: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private warnedNearCapacity = false;

  constructor(options: InMemoryCacheOptions = {}) {
    const {
      sweepIntervalMs = 0,
      maxEntries = DEFAULT_MAX_ENTRIES,
      warningThreshold = DEFAULT_WARNING_THRESHOLD,
    } = options;

    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.warningThreshold = Math.min(1, Math.max(0, warningThreshold));

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

    this.markRecentlyUsed(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
    this.evictIfNeeded();
    this.warnIfNearCapacity();
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

  private markRecentlyUsed(key: string, entry: CacheEntry<unknown>): void {
    this.store.delete(key);
    this.store.set(key, entry);
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (!oldest) return;
      this.store.delete(oldest);
    }
  }

  private warnIfNearCapacity(): void {
    if (this.warnedNearCapacity || this.store.size < this.maxEntries * this.warningThreshold) return;
    this.warnedNearCapacity = true;
    console.warn(
      `InMemoryCache is ${this.store.size}/${this.maxEntries} entries full; consider Redis or a lower TTL under sustained load.`,
    );
  }
}
