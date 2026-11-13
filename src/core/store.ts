import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Identity, AuditEvent, Rotation } from './types.js';

// ponytail: JSON-file document store with a Mongo-shaped API (insert/find/update).
// Swap for a real MongoDB collection behind the same methods when deploying to GCP.
export class Store {
  identities = new Map<string, Identity>();
  audit: AuditEvent[] = [];
  rotations = new Map<string, Rotation>();
  constructor(private file?: string) { if (file && existsSync(file)) this.load(); }
  private load() {
    const d = JSON.parse(readFileSync(this.file!, 'utf8'));
    d.identities.forEach((i: Identity) => this.identities.set(i.id, i));
    this.audit = d.audit ?? []; (d.rotations ?? []).forEach((r: Rotation) => this.rotations.set(r.id, r));
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ identities: [...this.identities.values()], audit: this.audit, rotations: [...this.rotations.values()] }, null, 2));
  }
  log(actor: string, action: string, target: string, allowed: boolean, detail: string) {
    this.audit.push({ ts: new Date().toISOString(), actor, action, target, allowed, detail });
  }
}
