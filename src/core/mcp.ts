import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Store } from './store.js';

// MCP token broker: agents never hold long-lived credentials. They exchange an
// agent identity for a short-lived, scope-checked HMAC token; every tool call
// through the gateway is verified and written to the audit log.
export const TOOLS: Record<string, { scope: string; run: (args: any) => any }> = {
  'db.query':    { scope: 'db.read',     run: (a) => ({ rows: [], query: String(a?.query ?? '').slice(0, 80) }) },
  'storage.get': { scope: 'storage.read', run: (a) => ({ object: a?.path ?? 'unknown', bytes: 0 }) },
  'queue.send':  { scope: 'queue.publish', run: (a) => ({ queued: true, topic: a?.topic ?? 'default' }) },
  'deploy.run':  { scope: 'deploy.write', run: () => ({ deployed: false, note: 'mock deploy, no-op' }) },
};
export interface BrokerToken { token: string; agent: string; scopes: string[]; exp: number; jti: string; }

export class Broker {
  constructor(private store: Store, private secret = 'dev-only-broker-secret', private ttlSec = 60) {}
  issue(agent: string, scopes: string[], now = Date.now()): BrokerToken {
    const payload: BrokerToken = { token: '', agent, scopes, exp: now + this.ttlSec * 1000, jti: randomUUID() };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    payload.token = `${body}.${this.sign(body)}`;
    this.store.log(agent, 'mcp.token.issue', agent, true, `scopes=${scopes.join(',')} ttl=${this.ttlSec}s jti=${payload.jti}`);
    return payload;
  }
  private sign(body: string) { return createHmac('sha256', this.secret).update(body).digest('base64url'); }
  verify(token: string, now = Date.now()): BrokerToken {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new Error('malformed token');
    const expected = this.sign(body);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('bad signature');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as BrokerToken;
    if (payload.exp < now) throw new Error('token expired');
    return payload;
  }
  call(token: string, tool: string, args: any = {}, now = Date.now()) {
    let agent = 'unknown';
    try {
      const payload = this.verify(token, now); agent = payload.agent;
      const t = TOOLS[tool];
      if (!t) throw new Error(`unknown tool ${tool}`);
      if (!payload.scopes.includes(t.scope)) throw new Error(`missing scope ${t.scope}`);
      const result = t.run(args);
      this.store.log(agent, 'mcp.tool.call', tool, true, `scope=${t.scope} jti=${payload.jti}`);
      return { ok: true, result };
    } catch (e: any) {
      this.store.log(agent, 'mcp.tool.call', tool, false, e.message);
      return { ok: false, error: e.message };
    }
  }
}
