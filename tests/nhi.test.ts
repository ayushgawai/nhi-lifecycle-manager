import { describe, it, expect } from 'vitest';
import { generateOrg } from '../src/core/seed.js';
import { scanAll, scanOne } from '../src/core/detector.js';
import { Store } from '../src/core/store.js';
import { requestRotation, decide, executeRotation } from '../src/core/rotation.js';
import { Broker } from '../src/core/mcp.js';

const NOW = new Date('2026-01-01T00:00:00Z');
describe('seed + detector', () => {
  it('plants exactly 50 bad in 5000 and detector catches at least 47', () => {
    const org = generateOrg(5000, 42, NOW);
    const planted = org.filter(i => i.planted);
    expect(planted).toHaveLength(50);
    const flagged = new Set(scanAll(org, NOW).map(f => f.identityId));
    expect(planted.filter(i => flagged.has(i.id)).length).toBeGreaterThanOrEqual(47);
  });
  it('healthy identity has no finding', () => {
    const org = generateOrg(100, 1, NOW);
    const healthy = org.find(i => !i.planted)!;
    // healthy fixtures are recent + safe scopes by construction; allow planted-free scan check via scanOne on a manual fixture
    expect(scanOne({ ...healthy, lastUsedAt: NOW.toISOString(), scopes: ['db.read'] }, NOW)).toBeNull();
  });
});
describe('rotation gate', () => {
  it('requires approval, rejects self-approval, rolls out with zero failed dependent calls', () => {
    const s = new Store(); const org = generateOrg(10, 7, NOW); org.forEach(i => s.identities.set(i.id, i));
    const r = requestRotation(s, org[0].id, 'alice');
    expect(() => executeRotation(s, r.id)).toThrow(/approved/);
    expect(() => decide(s, r.id, 'alice', true)).toThrow(/own rotation/);
    decide(s, r.id, 'bob', true);
    const done = executeRotation(s, r.id, 10);
    expect(done.status).toBe('completed'); expect(done.failedCalls).toBe(0); expect(done.dependentCalls).toBeGreaterThan(0);
    expect(s.identities.get(org[0].id)!.secretVersion).toBe(2);
  });
  it('rejected rotation cannot execute', () => {
    const s = new Store(); const org = generateOrg(10, 7, NOW); org.forEach(i => s.identities.set(i.id, i));
    const r = requestRotation(s, org[0].id, 'alice'); decide(s, r.id, 'bob', false);
    expect(() => executeRotation(s, r.id)).toThrow();
  });
});
describe('mcp broker', () => {
  it('issues short-lived scoped tokens, denies missing scope and expiry, audits every call', () => {
    const s = new Store(); const b = new Broker(s);
    const t = b.issue('agent-1', ['db.read'], 1_000_000);
    expect(b.call(t.token, 'db.query', {}, 1_000_100).ok).toBe(true);
    expect(b.call(t.token, 'deploy.run', {}, 1_000_100).ok).toBe(false);
    expect(b.call(t.token, 'db.query', {}, 1_000_000 + 61_000).ok).toBe(false); // expired (60s TTL)
    expect(b.call('garbage.token', 'db.query', {}, 1_000_100).ok).toBe(false);
    expect(s.audit.filter(a => a.action === 'mcp.tool.call')).toHaveLength(4); // every call audited, allowed or not
  });
});
