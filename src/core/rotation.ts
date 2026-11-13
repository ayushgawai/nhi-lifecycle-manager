import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Rotation } from './types.js';

// Simulated dependent call: a service presents a secret version; during the
// dual-valid window both old and new are accepted, after cutover only new.
export function dependentCall(accepted: number[], presented: number): boolean {
  return accepted.includes(presented);
}

export function requestRotation(store: Store, identityId: string, requestedBy: string): Rotation {
  const idn = store.identities.get(identityId);
  if (!idn) throw new Error(`unknown identity ${identityId}`);
  const r: Rotation = { id: randomUUID(), identityId, requestedBy, status: 'pending_approval', oldVersion: idn.secretVersion, createdAt: new Date().toISOString(), steps: ['requested'], dependentCalls: 0, failedCalls: 0 };
  store.rotations.set(r.id, r);
  store.log(requestedBy, 'rotation.request', identityId, true, `v${idn.secretVersion} rotation requested`);
  return r;
}

export function decide(store: Store, rotationId: string, approver: string, approve: boolean): Rotation {
  const r = store.rotations.get(rotationId);
  if (!r) throw new Error(`unknown rotation ${rotationId}`);
  if (r.status !== 'pending_approval') throw new Error(`rotation is ${r.status}, not pending_approval`);
  if (approver === r.requestedBy) throw new Error('requester cannot approve their own rotation');
  r.approver = approver;
  r.status = approve ? 'approved' : 'rejected';
  r.steps.push(approve ? `approved by ${approver}` : `rejected by ${approver}`);
  store.log(approver, approve ? 'rotation.approve' : 'rotation.reject', r.identityId, true, rotationId);
  return r;
}

// Staged rollout: issue new version -> dual-valid (dependents migrate) -> cutover -> revoke old.
// Every dependent presents old until it migrates, then new; nothing is ever presented after revocation except new.
export function executeRotation(store: Store, rotationId: string, callsPerDependent = 10): Rotation {
  const r = store.rotations.get(rotationId);
  if (!r) throw new Error(`unknown rotation ${rotationId}`);
  if (r.status !== 'approved') throw new Error(`rotation must be approved before rollout (is ${r.status})`);
  const idn = store.identities.get(r.identityId)!;
  r.status = 'rolling_out';
  const oldV = idn.secretVersion, newV = oldV + 1;
  r.newVersion = newV; r.steps.push(`issued v${newV} (dual-valid with v${oldV})`);
  let accepted = [oldV, newV];
  for (const dep of idn.dependents.length ? idn.dependents : ['direct-caller']) {
    for (let c = 0; c < callsPerDependent; c++) {
      r.dependentCalls++;
      // Halfway through a dependent's calls it picks up the new secret from the (mock) secret manager.
      const presented = c < callsPerDependent / 2 ? oldV : newV;
      if (!dependentCall(accepted, presented)) r.failedCalls++;
    }
    r.steps.push(`${dep} migrated to v${newV}`);
  }
  accepted = [newV];
  idn.secretVersion = newV; idn.secret = `secret-${idn.id}-v${newV}`;
  r.steps.push(`cutover: revoked v${oldV}`);
  r.status = r.failedCalls === 0 ? 'completed' : 'failed';
  store.log('system', 'rotation.execute', r.identityId, r.failedCalls === 0, `${r.dependentCalls} dependent calls, ${r.failedCalls} failed`);
  return r;
}
