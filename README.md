# NHI Lifecycle Manager

Non-human identity governance: inventory service accounts, API keys, OAuth apps, and AI agent tokens; detect stale and over-privileged credentials; rotate them through approval-gated staged rollouts; and broker AI agent tool access through an MCP gateway that issues short-lived scoped tokens and audits every call.

TypeScript + Node.js + React. Runs entirely on a laptop: no cloud account, no Docker, no external database required. The document store is a small JSON-file store behind a Mongo-shaped API (`insert/find`-style access in `src/core/store.ts`), so it can be swapped for a real MongoDB collection on Google Cloud (Cloud Run + Atlas/Firestore) without changing detector, rotation, or broker logic.

## Design

```
                        +----------------------+
  Synthetic org ------> |  Inventory (Store)   |  owner, scopes, last use,
  (5,000 NHIs, seeded)  |  service accounts,   |  secret version, dependents
                        |  API keys, OAuth,    |
                        |  AI agent tokens     |
                        +----------+-----------+
                                   | scan
                        +----------v-----------+
                        |  Detector            |  stale >= 90d unused,
                        |  risk scoring        |  dangerous/broad scopes
                        +----------+-----------+
                                   | findings
                        +----------v-----------+      approve/reject
                        |  Rotation workflow   | <--- (different person
                        |  pending -> approved |      than requester)
                        |  -> staged rollout   |
                        |  dual-valid -> cutover -> revoke old
                        +----------+-----------+
                                   |
              +--------------------+--------------------+
              |                                         |
   +----------v-----------+                  +----------v-----------+
   | Dependent services   |                  | MCP token broker     |
   | present old/new      |                  | HMAC tokens, 60s TTL,|
   | secret during window |                  | scope-checked tools  |
   +----------------------+                  +----------+-----------+
                                                        | every call
                                             +----------v-----------+
                                             | Audit log            |
                                             | (allowed AND denied) |
                                             +----------------------+

  React UI (src/web) ---- HTTP /api ---- Node server (src/server.ts) ---- core modules
  CLI (src/cli.ts) ------- same core modules, no server needed
```

| Concern | Implementation | File |
|---|---|---|
| Inventory | In-memory document store, optional JSON persistence, Mongo-shaped access pattern | `src/core/store.ts` |
| Synthetic org | Deterministic seeded generator (mulberry32), 4 NHI kinds, exactly 50 planted bad credentials as ground truth | `src/core/seed.ts` |
| Detection | Rule-based: unused ≥ 90 days = stale; `*`/`*.admin` or > 8 scopes = over-privileged; 0–100 risk score | `src/core/detector.ts` |
| Rotation | Request → approval (no self-approval) → staged rollout with dual-valid secret window → cutover → revoke old | `src/core/rotation.ts` |
| MCP broker | HMAC-signed short-lived tokens (60s TTL), per-tool required scope, allow/deny + audit on every call | `src/core/mcp.ts` |
| API | Node `http` server, `/api/identities`, `/api/findings`, `/api/rotations`, `/api/mcp/*`, `/api/audit`, `/api/stats` | `src/server.ts` |
| UI | React dashboard: stats, findings table with rotate action, MCP broker demo, audit trail | `src/web/main.tsx` |
| Benchmark | Full-org scan vs ground truth, 50 gated rotations, 1,000 brokered MCP calls | `src/bench.ts` |

## Run

```bash
npm install
npm run build        # tsc (core/server/CLI) + vite (React UI)
node dist/server.js  # API + UI on http://localhost:8080
npm run dev          # optional: vite dev UI on :5173 (proxies /api to :8080)
```

CLI (no server needed):

```bash
npm run seed                          # seed 5,000 identities into data/nhi.json
node dist/cli.js scan                 # print top findings
node dist/cli.js rotate nhi-00123     # request + approve + staged rollout for one identity
node dist/cli.js mcp-demo             # issue a token, make an allowed and a denied tool call
```

## Test

```bash
npm test   # vitest, 5 tests
```

Covers: planted-ground-truth detection (≥ 47 of 50), healthy-credential cleanliness, the approval gate (unapproved and self-approved rotations cannot execute), zero failed dependent calls in staged rollout, secret version increment, and broker scope/expiry/forgery denial with complete audit logging.

## Bench

```bash
npm run bench
```

Laptop sanity run actually measured on the development laptop (Node 26, deterministic seed — rerunning reproduces these numbers; scan time will vary slightly):

```json
{
  "identities": 5000,
  "plantedBad": 50,
  "flagged": 50,
  "truePositives": 50,
  "falseNegatives": 0,
  "falsePositives": 0,
  "scanMs": 1.6,
  "rotations": 50,
  "dependentCalls": 650,
  "failedDependentCalls": 0,
  "mcp": {
    "tokensIssued": 1000,
    "allowedCalls": 800,
    "deniedCalls": 200,
    "auditEvents": 2000
  }
}
```

Reading the targets against measurement:

- **Detection:** target was flagging 47 of 50 seeded stale/over-privileged credentials in a 5,000-identity org. Measured: **50 of 50 flagged, 0 false positives, 0 missed**, full scan in ~1.6 ms. The planted credentials are deliberately unambiguous (≥ 120 days unused, or an explicit admin/`*` scope), so a perfect score says the rules work, not that detection is hard — see Limitations.
- **Rotation:** all 50 flagged credentials rotated through request → approval → staged rollout; **650 simulated dependent calls, 0 failed** (dependents present the old secret until they pick up the new one from the dual-valid window, then the new one; the old version is revoked only after migration).
- **MCP broker:** 1,000 tokens issued (60s TTL), 1,000 tool calls — 800 allowed, 200 denied for missing scope by construction — producing **2,000 audit events (1,000 issuances + 1,000 calls; every call audited, allowed or denied)**.

## Honest limitations

- **Simulated dependents and tools.** Dependent calls and MCP tools (`db.query`, `storage.get`, `queue.send`, `deploy.run`) are mocks. The dual-valid rollout logic is real, but no actual secret manager (e.g. GCP Secret Manager), MCP transport (stdio/SSE), or downstream service is integrated.
- **Local store, not MongoDB/GCP.** Persistence is a JSON file behind a Mongo-shaped internal API. There is no Cloud Run deployment, IAM integration, or real GCP service-account inventory import — the platform is *modeled on* that architecture and deploys locally. Swapping `Store` for MongoDB is the intended next step.
- **Easy ground truth.** Planted bad credentials are clear-cut, so 50/50 detection is expected, not impressive. Real detection needs usage-baseline anomaly detection (scopes granted vs scopes ever exercised), which is not implemented — unused-scope analysis only uses `lastUsedAt` per credential, not per scope.
- **Broker security is laptop-grade.** Tokens are HMACs with a hardcoded dev secret; there is no key rotation for the broker itself (ironic, noted), no agent identity proofing/mTLS, and audit is an append-only in-memory/file list, not a tamper-evident log.
- **Scale tested is the full target scale** (5,000 identities) because it is cheap in memory; nothing here validates behavior at 500k identities or under concurrent rotation load.

## License

MIT — see `LICENSE`.
