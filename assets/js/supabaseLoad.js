import { logger } from "./logger.js";

const inflight = new Map();
const cache = new Map();
const channelRegistry = new Map();
const writeRegistry = new Map();

export function dedupeRequest(key, fn) {
  if (inflight.has(key)) {
    logger.log("[SupabaseLoad] request deduped", key);
    return inflight.get(key);
  }
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function withRetry(label, fn, { maxRetries = 2, baseDelayMs = 300 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      const status = error?.status ?? error?.code;
      const shouldStop = [401, 402, 403].includes(Number(status));
      if (shouldStop || attempt >= maxRetries) {
        logger.warn("[SupabaseLoad] retry stopped", { label, attempt, status });
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

export function cachedRead(key, ttlMs, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.value);
  return dedupeRequest(`cache:${key}`, async () => {
    const value = await fn();
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });
}

export function invalidateCache(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function subscribeUnique(supabase, key, factory) {
  const existing = channelRegistry.get(key);
  if (existing) return existing;
  const channel = factory(supabase);
  channelRegistry.set(key, channel);
  logger.log("[SupabaseLoad] realtime subscribed", { key, openChannels: channelRegistry.size });
  return channel;
}

export function unsubscribeUnique(supabase, key) {
  const channel = channelRegistry.get(key);
  if (!channel) return;
  supabase.removeChannel(channel);
  channelRegistry.delete(key);
  logger.log("[SupabaseLoad] realtime unsubscribed", { key, openChannels: channelRegistry.size });
}

export function shouldWrite(key, payload, minIntervalMs = 60000) {
  const now = Date.now();
  const serialized = JSON.stringify(payload ?? {});
  const prev = writeRegistry.get(key);
  if (prev && prev.payload === serialized && now - prev.at < minIntervalMs) {
    logger.log("[SupabaseLoad] write skipped duplicate", key);
    return false;
  }
  writeRegistry.set(key, { payload: serialized, at: now });
  return true;
}

export function logHiddenPollPause() {
  logger.log("[SupabaseLoad] polling paused hidden tab");
}
