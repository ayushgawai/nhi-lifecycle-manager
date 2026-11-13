import type { Identity, Finding } from './types.js';

const DANGEROUS = new Set(['*', 'iam.admin', 'storage.admin', 'db.admin', 'billing.admin']);
export const STALE_DAYS = 90;

export function scanOne(id: Identity, now = new Date()): Finding | null {
  const reasons: string[] = [];
  const unusedDays = (now.getTime() - new Date(id.lastUsedAt).getTime()) / 86400_000;
  const stale = unusedDays >= STALE_DAYS;
  if (stale) reasons.push(`unused for ${Math.floor(unusedDays)}d (>= ${STALE_DAYS}d)`);
  const dangerous = id.scopes.filter(s => DANGEROUS.has(s) || s.endsWith('.admin') || s === '*');
  const overPrivileged = dangerous.length > 0 || id.scopes.length > 8;
  if (dangerous.length) reasons.push(`dangerous scope(s): ${dangerous.join(', ')}`);
  if (id.scopes.length > 8) reasons.push(`broad scope set: ${id.scopes.length} scopes`);
  if (!id.owner) reasons.push('no owner');
  if (!reasons.length) return null;
  const risk = Math.min(100, (stale ? 45 : 0) + (overPrivileged ? 45 : 0) + (!id.owner ? 20 : 0) + Math.min(10, id.scopes.length));
  return { identityId: id.id, reasons, risk, stale, overPrivileged };
}
export function scanAll(ids: Identity[], now = new Date()): Finding[] {
  return ids.map(i => scanOne(i, now)).filter((f): f is Finding => !!f).sort((a, b) => b.risk - a.risk);
}
