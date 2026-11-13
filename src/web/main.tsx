import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const api = async (p: string, init?: any) => (await fetch(p, init)).json();
export function App() {
  const [stats, setStats] = useState<any>({}); const [findings, setFindings] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]); const [token, setToken] = useState(''); const [msg, setMsg] = useState('');
  const load = async () => { setStats(await api('/api/stats')); setFindings(await api('/api/findings')); setAudit(await api('/api/audit')); };
  useEffect(() => { load(); }, []);
  const rotate = async (id: string) => {
    const r = await api('/api/rotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identityId: id, requestedBy: 'ui-user' }) });
    await api(`/api/rotations/${r.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approver: 'ui-approver' }) });
    const done = await api(`/api/rotations/${r.id}/execute`, { method: 'POST' });
    setMsg(`Rotated ${id}: ${done.dependentCalls} dependent calls, ${done.failedCalls} failed`); load();
  };
  const getToken = async () => { const t = await api('/api/mcp/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'demo-agent', scopes: ['db.read'] }) }); setToken(t.token); setMsg('Issued 60s db.read token'); };
  const callTool = async (tool: string) => { const r = await api('/api/mcp/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, tool, args: { query: 'select 1' } }) }); setMsg(`${tool}: ${JSON.stringify(r)}`); load(); };
  return <main style={{ fontFamily: 'system-ui', maxWidth: 1100, margin: '24px auto', padding: 16 }}>
    <h1>NHI Lifecycle Manager</h1>
    <p>Non-human identity governance: inventory · stale/over-privileged detection · approval-gated rotation · MCP token broker</p>
    <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{Object.entries(stats).map(([k, v]: any) => <div key={k} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12 }}><b>{String(v)}</b><br />{k}</div>)}</section>
    {msg && <p role="status">{msg}</p>}
    <h2>MCP broker</h2>
    <button onClick={getToken}>Issue short-lived token (db.read)</button>{' '}
    <button disabled={!token} onClick={() => callTool('db.query')}>Call db.query</button>{' '}
    <button disabled={!token} onClick={() => callTool('deploy.run')}>Call deploy.run (should deny)</button>
    <h2>Findings (top 50)</h2>
    <table><thead><tr><th>Identity</th><th>Risk</th><th>Reasons</th><th /></tr></thead><tbody>
      {findings.slice(0, 50).map(f => <tr key={f.identityId}><td>{f.identityId}</td><td>{f.risk}</td><td>{f.reasons.join('; ')}</td><td><button onClick={() => rotate(f.identityId)}>Request + approve + rotate</button></td></tr>)}
    </tbody></table>
    <h2>Audit trail (latest)</h2>
    <pre style={{ overflow: 'auto', maxHeight: 300 }}>{audit.slice(-30).map(a => `${a.ts} ${a.actor} ${a.action} ${a.target} allowed=${a.allowed} ${a.detail}`).join('\n')}</pre>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
