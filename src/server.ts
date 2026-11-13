import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Store } from './core/store.js';
import { generateOrg } from './core/seed.js';
import { scanAll } from './core/detector.js';
import { requestRotation, decide, executeRotation } from './core/rotation.js';
import { Broker, TOOLS } from './core/mcp.js';

const store = new Store(process.env.DATA_FILE ?? 'data/nhi.json');
if (!store.identities.size) { generateOrg(5000).forEach(i => store.identities.set(i.id, i)); store.save(); }
const broker = new Broker(store);
const json = (res: any, code: number, body: any) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = async (req: any) => { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; };

createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  try {
    if (url.pathname === '/health') return json(res, 200, { ok: true, identities: store.identities.size });
    if (url.pathname === '/api/identities') return json(res, 200, [...store.identities.values()].slice(0, Number(url.searchParams.get('limit') ?? 200)));
    if (url.pathname === '/api/findings') return json(res, 200, scanAll([...store.identities.values()]));
    if (url.pathname === '/api/audit') return json(res, 200, store.audit.slice(-500));
    if (url.pathname === '/api/tools') return json(res, 200, Object.entries(TOOLS).map(([name, t]) => ({ name, scope: t.scope })));
    if (url.pathname === '/api/stats') {
      const f = scanAll([...store.identities.values()]);
      return json(res, 200, { identities: store.identities.size, findings: f.length, stale: f.filter(x => x.stale).length, overPrivileged: f.filter(x => x.overPrivileged).length, rotations: store.rotations.size, auditEvents: store.audit.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/rotations') { const b = await body(req); return json(res, 201, requestRotation(store, b.identityId, b.requestedBy ?? 'ui')); }
    const m = url.pathname.match(/^\/api\/rotations\/([^/]+)\/(approve|reject|execute)$/);
    if (req.method === 'POST' && m) {
      const b = await body(req);
      const out = m[2] === 'execute' ? executeRotation(store, m[1]) : decide(store, m[1], b.approver ?? 'ui-approver', m[2] === 'approve');
      store.save(); return json(res, 200, out);
    }
    if (url.pathname === '/api/rotations') return json(res, 200, [...store.rotations.values()]);
    if (req.method === 'POST' && url.pathname === '/api/mcp/token') { const b = await body(req); return json(res, 201, broker.issue(b.agent ?? 'agent', b.scopes ?? [])); }
    if (req.method === 'POST' && url.pathname === '/api/mcp/call') { const b = await body(req); return json(res, 200, broker.call(b.token, b.tool, b.args ?? {})); }
    // static frontend (vite build output) if present
    const file = join('dist-web', url.pathname === '/' ? 'index.html' : url.pathname);
    if (existsSync(file)) { res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html' }); return res.end(readFileSync(file)); }
    json(res, 404, { error: 'not found' });
  } catch (e: any) { json(res, 400, { error: e.message }); }
}).listen(Number(process.env.PORT ?? 8080), () => console.log(`NHI Lifecycle Manager API on :${process.env.PORT ?? 8080}`));
