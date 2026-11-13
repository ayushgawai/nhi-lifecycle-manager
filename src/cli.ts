import { Store } from './core/store.js';
import { generateOrg } from './core/seed.js';
import { scanAll } from './core/detector.js';
import { requestRotation, decide, executeRotation } from './core/rotation.js';
import { Broker } from './core/mcp.js';

const cmd = process.argv[2] ?? 'help';
const NOW = new Date('2026-01-01T00:00:00Z');
function seededStore(file = 'data/nhi.json') {
  const s = new Store(file);
  if (!s.identities.size) { generateOrg(5000, 42, NOW).forEach(i => s.identities.set(i.id, i)); s.log('cli', 'seed', 'org', true, '5000 identities'); s.save(); }
  return s;
}
if (cmd === 'seed') { const s = seededStore(); console.log(`seeded ${s.identities.size} identities -> data/nhi.json`); }
else if (cmd === 'scan') { const s = seededStore(); const f = scanAll([...s.identities.values()], NOW); console.log(`${f.length} findings`); f.slice(0, 20).forEach(x => console.log(x.identityId, `risk=${x.risk}`, x.reasons.join('; '))); }
else if (cmd === 'rotate') {
  const s = seededStore(); const id = process.argv[3]; if (!id) throw new Error('usage: cli rotate <identityId>');
  const r = requestRotation(s, id, 'cli-user'); decide(s, r.id, 'cli-approver', true); console.log(executeRotation(s, r.id)); s.save();
} else if (cmd === 'mcp-demo') {
  const s = new Store(); const b = new Broker(s);
  const t = b.issue('demo-agent', ['db.read']);
  console.log(b.call(t.token, 'db.query', { query: 'select 1' }));
  console.log(b.call(t.token, 'deploy.run')); // denied: missing deploy.write scope, still audited
  console.log(s.audit);
} else console.log('commands: seed | scan | rotate <id> | mcp-demo   (bench: npm run bench)');
