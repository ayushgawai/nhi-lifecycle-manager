export type Kind = 'service_account'|'api_key'|'oauth_app'|'ai_agent_token';
export interface Identity {
  id: string; kind: Kind; name: string; owner: string;
  scopes: string[]; createdAt: string; lastUsedAt: string;
  secretVersion: number; secret: string;
  dependents: string[]; // services that call with this credential
  planted?: 'stale'|'over_privileged'|'both'; // ground truth, synthetic only — never used by detector
}
export interface Finding { identityId: string; reasons: string[]; risk: number; stale: boolean; overPrivileged: boolean; }
export interface AuditEvent { ts: string; actor: string; action: string; target: string; allowed: boolean; detail: string; }
export interface Rotation {
  id: string; identityId: string; requestedBy: string; approver?: string;
  status: 'pending_approval'|'approved'|'rejected'|'rolling_out'|'completed'|'failed';
  oldVersion: number; newVersion?: number; createdAt: string; steps: string[];
  dependentCalls: number; failedCalls: number;
}
