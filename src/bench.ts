import { Store } from './core/store.js';
import { generateOrg } from './core/seed.js';
import { scanAll } from './core/detector.js';
import { requestRotation, decide, executeRotation } from './core/rotation.js';
import { Broker } from './core/mcp.js';

const NOW = new Date('2026-01-01T00:00:00Z');
function main() {
  const org = generateOrg(5000, 42, NOW);
  const store = new Store();
  org.forEach(i => store.identities.set(i.id, i));

  const t0 = performance.now();
  const findings = scanAll(org, NOW);
  const scanMs = performance.now() - t0;
  const planted = new Set(org.filter(i => i.planted).map(i => i.id));
  const flagged = new Set(findings.map(f => f.identityId));
  const tp = [...planted].filter(id => flagged.has(id)).length;

  // Rotate every planted credential through the approval gate + staged rollout.
  let depCalls = 0, failedCalls = 0, rotations = 0;
  for (const id of planted) {
    const r = requestRotation(store, id, 'sre-bot');
    decide(store, r.id, 'owner-oncall', true);
    const done = executeRotation(store, r.id, 10);
    depCalls += done.dependentCalls; failedCalls += done.failedCalls; rotations++;
  }

  // MCP broker: 1,000 issued tokens, 1,000 audited calls (mix of allowed/denied).
  const broker = new Broker(store);
  const auditBefore = store.audit.length;
  let ok = 0;
  for (let i = 0; i < 1000; i++) {
    const t = broker.issue(`agent-${i % 20}`, ['db.read']);
    const r = broker.call(t.token, i % 5 === 0 ? 'deploy.run' : 'db.query', { query: 'select 1' });
    if (r.ok) ok++;
  }
  const mcpAudit = store.audit.slice(auditBefore).filter(a => a.action.startsWith('mcp.')).length;

  console.log(JSON.stringify({
    identities: org.length, plantedBad: planted.size,
    flagged: findings.length, truePositives: tp, falseNegatives: planted.size - tp, falsePositives: findings.length - tp,
    scanMs: +scanMs.toFixed(1),
    rotations, dependentCalls: depCalls, failedDependentCalls: failedCalls,
    mcp: { tokensIssued: 1000, allowedCalls: ok, deniedCalls: 1000 - ok, auditEvents: mcpAudit },
  }, null, 2));
}
main();
