// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Artifact deduplication cache (item #43) and
 * Harvest result deduplication with Bloom filter (item #53).
 *
 * Two complementary dedup strategies:
 * 1. ArtifactDedupCache: exact-match LRU cache for fast hash lookups
 * 2. BloomFilter: probabilistic filter for harvest-time dedup (zero false negatives)
 */

/**
 * LRU deduplication cache for artifact hashes.
 * Provides O(1) exact-match duplicate detection without DB round-trips.
 */
export class ArtifactDedupCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSize=50000] - Maximum entries
   * @param {number} [options.ttlMs=3600000] - Entry TTL in ms (default 1 hour)
   */
  constructor({ maxSize = 50_000, ttlMs = 3_600_000 } = {}) {
    this._maxSize = maxSize;
    this._ttlMs = ttlMs;
    /** @type {Map<string, { id: string, ts: number }>} */
    this._cache = new Map();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Check if an artifact hash has been seen.
   * @param {string} hash - SHA-256 hash
   * @returns {{ isDuplicate: boolean, existingId?: string }}
   */
  check(hash) {
    const entry = this._cache.get(hash);
    if (entry) {
      if (Date.now() - entry.ts <= this._ttlMs) {
        this._hits++;
        // Move to end for LRU
        this._cache.delete(hash);
        this._cache.set(hash, entry);
        return { isDuplicate: true, existingId: entry.id };
      }
      // Expired
      this._cache.delete(hash);
    }
    this._misses++;
    return { isDuplicate: false };
  }

  /**
   * Record an artifact hash in the cache.
   * @param {string} hash
   * @param {string} id - Artifact ID
   */
  add(hash, id) {
    // Evict oldest if at capacity
    if (this._cache.size >= this._maxSize) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(hash, { id, ts: Date.now() });
  }

  /**
   * Batch-check multiple hashes.
   * @param {string[]} hashes
   * @returns {Map<string, string>} Map of hash -> existing ID (only duplicates)
   */
  checkBatch(hashes) {
    const duplicates = new Map();
    for (const hash of hashes) {
      const result = this.check(hash);
      if (result.isDuplicate) {
        duplicates.set(hash, result.existingId);
      }
    }
    return duplicates;
  }

  /**
   * Preload cache from database.
   * @param {object} db - Database client
   * @param {number} [limit=50000]
   */
  async preload(db, limit = 50_000) {
    try {
      const result = await db.query(
        `SELECT hash, id FROM artifacts ORDER BY updated_at DESC LIMIT $1`,
        [limit]
      );
      for (const row of result.rows) {
        this._cache.set(row.hash, { id: row.id, ts: Date.now() });
      }
    } catch {
      // Best-effort preload
    }
  }

  /** Cache statistics */
  getStats() {
    return {
      size: this._cache.size,
      maxSize: this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: this._hits + this._misses > 0
        ? this._hits / (this._hits + this._misses)
        : 0,
    };
  }

  /** Remove expired entries */
  prune() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this._cache) {
      if (now - entry.ts > this._ttlMs) {
        this._cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /** Clear the cache */
  clear() {
    this._cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  get size() {
    return this._cache.size;
  }
}

// ── Bloom Filter (#53) ──────────────────────────────────────────────────────

/**
 * Space-efficient Bloom filter for probabilistic harvest dedup.
 * Zero false negatives: if it says "not seen", it's definitely new.
 * Configurable false positive rate via size and hash count.
 */
export class BloomFilter {
  /**
   * @param {object} [options]
   * @param {number} [options.size=1000000] - Bit array size
   * @param {number} [options.hashCount=7] - Number of hash functions
   */
  constructor({ size = 1_000_000, hashCount = 7 } = {}) {
    this._size = size;
    this._hashCount = hashCount;
    this._bits = new Uint8Array(Math.ceil(size / 8));
    this._count = 0;
  }

  /**
   * Compute hash positions for a given key.
   * Uses double hashing: h(i) = (h1 + i * h2) mod size
   * @param {string} key
   * @returns {number[]}
   */
  _getPositions(key) {
    let h1 = 0;
    let h2 = 0;

    // FNV-1a inspired hash
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      h1 = ((h1 ^ c) * 16777619) >>> 0;
      h2 = ((h2 * 31) + c) >>> 0;
    }

    const positions = [];
    for (let i = 0; i < this._hashCount; i++) {
      positions.push(((h1 + i * h2) >>> 0) % this._size);
    }
    return positions;
  }

  /**
   * Add a key to the filter.
   * @param {string} key
   */
  add(key) {
    const positions = this._getPositions(key);
    let isNew = false;
    for (const pos of positions) {
      const byteIdx = pos >>> 3;
      const bitIdx = pos & 7;
      if (!(this._bits[byteIdx] & (1 << bitIdx))) {
        isNew = true;
      }
      this._bits[byteIdx] |= (1 << bitIdx);
    }
    if (isNew) this._count++;
  }

  /**
   * Check if a key might be in the filter.
   * @param {string} key
   * @returns {boolean} true = possibly in set, false = definitely not in set
   */
  mightContain(key) {
    const positions = this._getPositions(key);
    for (const pos of positions) {
      const byteIdx = pos >>> 3;
      const bitIdx = pos & 7;
      if (!(this._bits[byteIdx] & (1 << bitIdx))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Test and add in one operation (check then insert).
   * @param {string} key
   * @returns {boolean} true if key was already possibly present
   */
  testAndAdd(key) {
    const was = this.mightContain(key);
    this.add(key);
    return was;
  }

  /**
   * Estimated false positive rate.
   * @returns {number}
   */
  estimatedFPRate() {
    const bitsSet = this._countBitsSet();
    const ratio = bitsSet / this._size;
    return Math.pow(ratio, this._hashCount);
  }

  /** Count set bits */
  _countBitsSet() {
    let count = 0;
    for (let i = 0; i < this._bits.length; i++) {
      let byte = this._bits[i];
      while (byte) {
        count += byte & 1;
        byte >>= 1;
      }
    }
    return count;
  }

  /**
   * Reset the filter.
   */
  clear() {
    this._bits.fill(0);
    this._count = 0;
  }

  get count() {
    return this._count;
  }

  get size() {
    return this._size;
  }

  /**
   * Merge another Bloom filter into this one (union).
   * Both filters must have the same size and hashCount.
   * @param {BloomFilter} other
   */
  merge(other) {
    if (other._size !== this._size || other._hashCount !== this._hashCount) {
      throw new Error('Cannot merge Bloom filters with different parameters');
    }
    for (let i = 0; i < this._bits.length; i++) {
      this._bits[i] |= other._bits[i];
    }
  }

  /** Get fill ratio (fraction of bits set) */
  fillRatio() {
    return this._countBitsSet() / this._size;
  }
}

// ── Singleton factories ─────────────────────────────────────────────────────

let _dedupCache = null;
let _bloomFilter = null;

export function getDedupCache(options) {
  if (!_dedupCache) {
    _dedupCache = new ArtifactDedupCache(options);
  }
  return _dedupCache;
}

export function getBloomFilter(options) {
  if (!_bloomFilter) {
    _bloomFilter = new BloomFilter(options);
  }
  return _bloomFilter;
}
