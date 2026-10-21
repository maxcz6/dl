/**
 * Limitación de tasa in-process por clave (IP) con ventana deslizante
 * (FR-062). Suficiente para el monolito de una instancia; sin Redis
 * (Constitución II).
 */

type Bucket = {
  /** timestamps (ms) de los intentos */
  hits: number[];
  /** la ventana con la que se llenó: el barrido la necesita */
  windowMs: number;
};

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

/**
 * Las llaves son por IP en superficies públicas (login, `/api/bot/*`): quien
 * rote IPs —o falsee `x-forwarded-for` si la app queda sin proxy— estrena una
 * llave por request. Sin barrido, el mapa crecería para siempre; con él, la
 * memoria queda acotada por el tráfico de la última ventana.
 */
const SWEEP_AT = 10_000;
let lastSweep = 0;

function sweep(buckets: Map<string, Bucket>, now: number): void {
  if (buckets.size < SWEEP_AT || now - lastSweep < 1000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    const last = b.hits[b.hits.length - 1] ?? 0;
    if (last <= now - b.windowMs) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  sweep(buckets, now);
  const cutoff = now - opts.windowMs;
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => t > cutoff);

  if (hits.length >= opts.max) {
    buckets.set(key, { hits, windowMs: opts.windowMs });
    return { allowed: false, remaining: 0 };
  }
  hits.push(now);
  buckets.set(key, { hits, windowMs: opts.windowMs });
  return { allowed: true, remaining: opts.max - hits.length };
}

/**
 * La IP del cliente para LIMITAR, jamás para autorizar: el primer salto de
 * `x-forwarded-for` (detrás de Traefik/Coolify o Caddy es el cliente real),
 * luego `x-real-ip`, y "local" sin proxy. Sin proxy delante, el cliente
 * puede falsearla: por eso solo decide a quién frenar.
 */
export function clientIp(headers: Headers | null | undefined): string {
  return (
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip") ||
    "local"
  );
}

/** Solo para tests. */
export function resetRateLimit(): void {
  store().clear();
  lastSweep = 0;
}

/** Solo para tests: cuántas llaves vivas guarda el limitador. */
export function rateLimitKeys(): number {
  return store().size;
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };
