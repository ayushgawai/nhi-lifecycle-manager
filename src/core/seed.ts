import type { Identity, Kind } from './types.js';

// Deterministic PRNG so bench numbers reproduce on any laptop.
export function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KINDS: Kind[] = ['service_account', 'api_key', 'oauth_app', 'ai_agent_token'];
const OWNERS = ['payments', 'search', 'ml-platform', 'data-eng', 'growth', 'infra', 'support', 'analytics'];
const SAFE_SCOPES = ['storage.read', 'db.read', 'queue.publish', 'metrics.write', 'http.invoke', 'cache.read'];
const DANGEROUS = ['*', 'iam.admin', 'storage.admin', 'db.admin', 'billing.admin'];

export function generateOrg(n = 5000, seed = 42, now = new Date()): Identity[] {
  const rnd = mulberry32(seed);
  const out: Identity[] = [];
  const day = 86400_000;
  const mk = (i: number, planted?: Identity['planted']): Identity => {
    const kind = KINDS[Math.floor(rnd() * KINDS.length)];
    const scopeCount = 1 + Math.floor(rnd() * 3);
    const scopes = [...new Set(Array.from({ length: scopeCount }, () => SAFE_SCOPES[Math.floor(rnd() * SAFE_SCOPES.length)]))];
    let ageDays = 1 + Math.floor(rnd() * 30); // healthy: used recently
    if (planted === 'stale' || planted === 'both') ageDays = 120 + Math.floor(rnd() * 200);
    if (planted === 'over_privileged' || planted === 'both') scopes.push(DANGEROUS[Math.floor(rnd() * DANGEROUS.length)]);
    const created = new Date(now.getTime() - (ageDays + 30) * day);
    return {
      id: `nhi-${String(i).padStart(5, '0')}`, kind, name: `${kind}-${i}`,
      owner: OWNERS[Math.floor(rnd() * OWNERS.length)], scopes,
      createdAt: created.toISOString(), lastUsedAt: new Date(now.getTime() - ageDays * day).toISOString(),
      secretVersion: 1, secret: `secret-${i}-v1`,
      dependents: Array.from({ length: Math.floor(rnd() * 3) }, (_, k) => `svc-${Math.floor(rnd() * 200)}-${k}`),
      ...(planted ? { planted } : {}),
    };
  };
  for (let i = 0; i < n; i++) out.push(mk(i));
  // Plant exactly 50 ground-truth bad credentials, spread through the org.
  const kinds: Identity['planted'][] = [...Array(20).fill('stale'), ...Array(20).fill('over_privileged'), ...Array(10).fill('both')];
  kinds.forEach((p, k) => { const idx = Math.floor((k + 0.5) * n / 50); out[idx] = { ...mk(idx, p), id: out[idx].id, name: out[idx].name }; });
  return out;
}
