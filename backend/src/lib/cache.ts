import Redis from 'ioredis';
import { env } from '../config/env';

// Expensive prospectivity/geospatial computation must never re-run on every
// dashboard request — we read stored AnalysisJob/ProspectivityPrediction rows
// and cache the assembled response for a short TTL. Falls back to an
// in-memory map if Redis is unreachable, so local/dev environments still work.

type Entry = { value: string; expiresAt: number };
const memoryStore = new Map<string, Entry>();

let redis: Redis | null = null;
try {
  redis = new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.connect().catch(() => { redis = null; });
} catch {
  redis = null;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redis && redis.status === 'ready') {
    const raw = await redis.get(key).catch(() => null);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  const entry = memoryStore.get(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return JSON.parse(entry.value) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (redis && redis.status === 'ready') {
    await redis.set(key, serialized, 'EX', ttlSeconds).catch(() => {});
    return;
  }
  memoryStore.set(key, { value: serialized, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheInvalidate(prefix: string): Promise<void> {
  if (redis && redis.status === 'ready') {
    const keys = await redis.keys(`${prefix}*`).catch(() => [] as string[]);
    if (keys.length) await redis.del(...keys).catch(() => {});
  }
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) memoryStore.delete(key);
  }
}
