import { createHash } from "node:crypto";

// Shared by the marketing service in this process, including paginated requests.
const MAX_CONCURRENT = 4;
const MAX_QUEUE = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CACHE_ENTRIES = 2_000;
const DEFAULT_COOLDOWN_MS = 60_000;

const cache = new Map<string, { body: unknown; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();
let blockedUntil = 0;
let active = 0;
type Waiter = { resolve: () => void; timer: ReturnType<typeof setTimeout> };
const queue: Waiter[] = [];

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

function checkCooldown(): void {
  const remaining = blockedUntil - Date.now();
  if (remaining > 0) {
    throw new MetaGraphError("Meta API temporarily paused after rate limiting.", 429, undefined, remaining);
  }
}

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  if (queue.length >= MAX_QUEUE) throw new MetaGraphError("Meta API request queue is full.");
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      timer: setTimeout(() => {
        const index = queue.indexOf(waiter);
        if (index !== -1) queue.splice(index, 1);
        reject(new MetaGraphError("Meta API request queue timed out."));
      }, REQUEST_TIMEOUT_MS),
    };
    queue.push(waiter);
  });
}

function release(): void {
  const next = queue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  } else {
    active--;
  }
}

function cooldownDuration(response: Response): number {
  const header = response.headers.get("retry-after");
  if (!header) return DEFAULT_COOLDOWN_MS;
  const seconds = Number(header);
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_COOLDOWN_MS;
}

function appUsageExhausted(response: Response): boolean {
  try {
    const usage = JSON.parse(response.headers.get("x-app-usage") ?? "{}");
    return [usage.call_count, usage.total_cputime, usage.total_time]
      .some((value) => typeof value === "number" && value >= 100);
  } catch {
    return false;
  }
}

async function request<T>(url: string): Promise<T> {
  checkCooldown();
  await acquire();
  try {
    // Requests queued before the first throttled response must also stop.
    checkCooldown();
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.status === 429 || appUsageExhausted(response)) {
      blockedUntil = Math.max(blockedUntil, Date.now() + cooldownDuration(response));
    }
    const body = await response.json() as T & { error?: { code?: number } };
    const code = body.error?.code;
    if (code !== undefined && [4, 17, 32, 341, 613].includes(code)) {
      blockedUntil = Math.max(blockedUntil, Date.now() + cooldownDuration(response));
    }
    if (!response.ok || body.error) {
      // Remote messages and request URLs can contain credentials; omit both.
      throw new MetaGraphError(
        `Meta Graph API error (HTTP ${response.status}${code === undefined ? "" : `, code ${code}`}).`,
        response.status,
        code,
        blockedUntil > Date.now() ? blockedUntil - Date.now() : undefined,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof MetaGraphError) throw error;
    throw new MetaGraphError("Meta Graph API request failed or timed out.");
  } finally {
    release();
  }
}

/** Caches successful reads only; credentials, fields, dates and version form the key. */
export async function fetchMetaGraph<T>(url: string, cacheTtlMs = 0): Promise<T> {
  const canonical = new URL(url);
  canonical.searchParams.sort();
  const key = createHash("sha256").update(canonical.toString()).digest("hex");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(key);
    cache.set(key, cached);
    return structuredClone(cached.body) as T;
  }
  cache.delete(key);
  const pending = inFlight.get(key);
  if (pending) return structuredClone(await pending) as T;

  const result = request<T>(url).then((body) => {
    if (cacheTtlMs > 0) {
      for (const [entryKey, entry] of cache) {
        if (entry.expiresAt <= Date.now()) cache.delete(entryKey);
      }
      while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, { body: structuredClone(body), expiresAt: Date.now() + cacheTtlMs });
    }
    return body;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, result);
  return result;
}
