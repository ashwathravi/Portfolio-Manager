/**
 * CacheProvider — pluggable caching interface.
 *
 * The app ships with an in-memory implementation (InMemoryCache).
 * Swap in Redis, Memcached, or any other backend by implementing this
 * interface — no changes needed in services or controllers.
 *
 * Linear: AR-47
 */

export interface CacheProvider {
  /** Retrieve a cached value, or `undefined` on miss / expiry. */
  get<T>(key: string): T | undefined;

  /** Store a value with a time-to-live in seconds. */
  set<T>(key: string, value: T, ttlSeconds: number): void;

  /** Check whether a non-expired entry exists for `key`. */
  has(key: string): boolean;

  /** Remove a single entry. */
  delete(key: string): void;

  /** Remove all entries. */
  clear(): void;
}
