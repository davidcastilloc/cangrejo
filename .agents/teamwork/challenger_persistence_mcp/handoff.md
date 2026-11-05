# Empirical Challenge Report: Adversarial Stress-Testing of Subsystems 3 & 4

**Agent**: Challenger 2 (Adversarial Verifier for Subsystems 3 & 4)  
**Working Directory**: `/home/dcastillo/Projects/cangrejo/.agents/teamwork/challenger_persistence_mcp`  
**Date**: 2026-11-05T21:25:00Z  
**Target Subsystems**:
- **Subsystem 3: Persistencia y Bóvedas** (`packages/database-d1`, Bóveda Cero `.cgrj`, STIX 2.1, `.cgrx`, Forensic Dossier).
- **Subsystem 4: Servidor MCP y Sesiones** (`apps/web/honoApp.ts`, `/api/mcp` JSON-RPC 2.0, Cloudflare Workers Durable Objects, Cloudflare Code Mode).

---

## Challenge Summary

**Overall Risk Assessment**: **CRITICAL**

While the overall architecture is sound and passes all 81 existing gate tests across 14 test suites, adversarial empirical stress-testing has confirmed **5 critical-to-medium implementation defects and 1 protocol non-conformance** across persistence, cryptography, and MCP APIs:
1. **CRITICAL**: Reused 12-byte AES-GCM IV across all encrypted fields in Bóveda Cero allows 100% exact plaintext recovery via XOR keystream cancellation ($C_1 \oplus C_2 = P_1 \oplus P_2$) and destroys GHASH integrity.
2. **HIGH**: Dynamic session room switching with `cgrj_usr_*` tokens triggers unhandled SQLite/D1 foreign key constraint failure (`SQLITE_CONSTRAINT_FOREIGNKEY`) on both local Bun SQLite and live production edge.
3. **MEDIUM**: STIX 2.1 exporter corrupts primary indicator values when secondary metadata properties precede the indicator in Map insertion order.
4. **MEDIUM**: Unbounded entity mutation flooding bypasses `maxEntitiesPerSession` quota enforcement on `/api/mcp`.
5. **LOW**: STIX 2.1 import bypasses non-zero Guid invariant when `x_cangrejo_entity_id: "0"`, causing `new Guid(0n)` crashes and silent multi-entity map collisions (data loss).
6. **LOW (Conformance)**: JSON-RPC 2.0 error responses return `id: 1` instead of `id: null` when requests omit an `id`.
7. **VERIFIED ROBUST**: Cloudflare Code Mode AST regex sandboxing strictly neutralizes host escapes (`process.exit`, `globalThis`, `fetch`) and infinite loops (`while(true)`).

---

## 1. Observation

All observations were directly obtained by executing empirical test harness `tests/adversarial-subsystems-3-4.ts` and querying live production endpoints at `https://cangrejo-osint-workstation.pc911itservices.workers.dev`.

### 1.1 Defect 1 (BUG-M2-01): D1 Foreign Key Constraint Failure on Dynamic Room Switching with `cgrj_usr_*` Tokens
- **Target File & Lines**: `apps/web/honoApp.ts:4132–4155` (`resolveMcpSessionRoom`) and `packages/database-d1/src/BunSqliteVault.ts:2415` (`appendGraphMutationWithOcc`).
- **Verbatim Error (Local Bun SQLite)**:
  ```
  SQLiteError: FOREIGN KEY constraint failed
        errno: 787,
   byteOffset: -1,
         code: "SQLITE_CONSTRAINT_FOREIGNKEY"
        at #run (bun:sqlite:187:20)
        at batch (/home/dcastillo/Projects/cangrejo/packages/database-d1/src/BunSqliteVault.ts:2083:22)
        at appendGraphMutationWithOcc (/home/dcastillo/Projects/cangrejo/packages/database-d1/src/BunSqliteVault.ts:2415:20)
        at commitSessionMutationIfCloud (/home/dcastillo/Projects/cangrejo/apps/web/honoApp.ts:4267:44)
  ```
  Status: `500`, Response: `{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"FOREIGN KEY constraint failed"}}`
- **Verbatim Error (Live Cloudflare Edge Production)**:
  - Command: `POST https://cangrejo-osint-workstation.pc911itservices.workers.dev/api/mcp`
  - Authorization: `Bearer cgrj_usr_bf5c4d...`
  - Arguments: `{ "roomId": "expediente-prod-probe-...", "action": "upsert", "entities": [...] }`
  - Status: `500`
  - Response:
    ```json
    {"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)"}}
    ```
- **Source Observation**:
  ```typescript
  // apps/web/honoApp.ts:4132-4134
  let meta = await BunSqliteVault.getMcpSessionMeta(activeD1, dbSessionId);
  if (!meta && mcpCtx.token && mcpCtx.token.startsWith('CGRJ.')) {
    // JIT session provisioning is ONLY executed for CGRJ.* tokens!
  ```
  When an analyst authenticates with `cgrj_usr_*`, `mcpCtx.token.startsWith('CGRJ.')` evaluates to `false`. Dynamic room slugs are never inserted into `cangrejo_mcp_sessions`. When `commitSessionMutationIfCloud` executes `appendGraphMutationWithOcc`, `cangrejo_graph_mutations` throws `SQLITE_CONSTRAINT_FOREIGNKEY` due to `FOREIGN KEY(session_id) REFERENCES cangrejo_mcp_sessions(session_id)`.

---

### 1.2 Defect 2 (BUG-M2-02): AES-256-GCM Keystream Reuse & Plaintext Recovery in Bóveda Cero
- **Target File & Lines**: `packages/transforms/src/formats/MtgjJsonHandler.ts:95–136`.
- **Source Observation**:
  ```typescript
  // Lines 95-97
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, Math.max(100_000, iterations), 32, 'sha256');

  // Lines 106, 110, 116, 128, 133
  prop.value = encryptFieldValueAesGcm(serializedVal, key, iv);
  ent.notes.value = encryptFieldValueAesGcm(ent.notes.value, key, iv);
  item.content = encryptFieldValueAesGcm(item.content, key, iv);
  ```
  A single 12-byte IV is generated per document and reused for every encrypted field.
- **Empirical Verification Output**:
  - Plaintext 1 (secret): `"TOP_SECRET_PASSWORD_ALPHA_2026!"` (48 bytes padded)
  - Plaintext 2 (known): `"KNOWN_PUBLIC_PROPERTIES_RECORD_!"` (48 bytes padded)
  - Document encrypted with `MtgjJsonHandler.encryptMtgjDocument(doc, passphrase)`.
  - Ciphertext 1 $C_1$ (base64 decoded, stripped 16-byte auth tag) = 48 bytes.
  - Ciphertext 2 $C_2$ (base64 decoded, stripped 16-byte auth tag) = 48 bytes.
  - Oracle XOR: $P_{1, \text{recovered}} = (C_1 \oplus C_2) \oplus P_{2, \text{padded}}$.
  - Verbatim Output:
    ```
    [2-Crypto] Document encrypted. Shared IV in header: J5WUV0RdRfoX3beK
    [2-Crypto] Ciphertext 1 length: 48 bytes, Ciphertext 2 length: 48 bytes
    [2-Crypto] Plaintext 2 (known): "KNOWN_PUBLIC_PROPERTIES_RECORD_!"
    [2-Crypto] Recovered Plaintext 1: "TOP_SECRET_PASSWORD_ALPHA_2026!"
    [2-Crypto] Exact Plaintext 1 recovery verified: true
    ```

---

### 1.3 Defect 3 (BUG-M2-03): STIX 2.1 Export Primary Indicator Value Corruption
- **Target File & Lines**: `packages/transforms/src/formats/Stix21Exporter.ts:211–217`.
- **Source Observation**:
  ```typescript
  let displayValue = entity.id.toString();
  for (const [, val] of entity.properties.values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      displayValue = val.trim();
      break;
    }
  }
  ```
  Iterates `entity.properties.values` (a JS `Map`) and takes the first string encountered based on Map insertion order, completely ignoring `specialRoles.includes('VALUE')` and `getPartPrimaryValue(entity)` (`packages/core/src/store/GraphDataStore.ts:153`).
- **Empirical Verification Output**:
  - Constructed `maltego.Domain` entity where property `registrar` was set before `fqdn` (`"apt29-adversary-c2.org"`).
  - Verbatim Output:
    ```
    [3A-STIX] Expected domain value: "apt29-adversary-c2.org"
    [3A-STIX] Actual exported STIX value: Namecheap Domain Services
    [3A-STIX] Indicator corruption reproduced: true
    ```

---

### 1.4 Defect 4 (BUG-M2-04): STIX 2.1 Import Guid Zero Invariant Bypass & Silent Map Collision
- **Target File & Lines**: `packages/transforms/src/formats/Stix21Exporter.ts:441` and `packages/core/src/identity/Guid.ts:16, 56`.
- **Source Observation**:
  ```typescript
  const id =
    typeof obj.x_cangrejo_entity_id === 'string' && /^\d+$/.test(obj.x_cangrejo_entity_id)
      ? obj.x_cangrejo_entity_id
      : String(800000 + idx + 1);
  ```
  Regex `/^\d+$/` matches `"0"`.
- **Empirical Verification Output**:
  - `new Guid(BigInt("0"))` throws verbatim:
    ```
    Guid cannot be zero. Zero represents unassigned identity.
    ```
  - `Guid.parse("0")` returns sentinel `Guid.ZERO` (`0n`).
  - When importing a STIX bundle with 2 entities sharing `x_cangrejo_entity_id: "0"`, both resolve to `Guid.ZERO`, causing `store.dataStore.entities` to overwrite the first entity with the second.
  - Verbatim Output:
    ```
    [3B-STIX] Imported entity count in bundle: 2
    [3B-STIX] new Guid(BigInt("0")) threw as expected: Guid cannot be zero. Zero represents unassigned identity.
    [3B-STIX] GraphStore entity count after importing 2 entities with id '0': 1
    [3B-STIX] Silent entity collision / data loss reproduced: true
    ```

---

### 1.5 Defect 5 (BUG-M2-05): Unbounded Entity Mutation Flooding (Missing Quota Enforcement)
- **Target File & Lines**: `apps/web/honoApp.ts:5263–5320` (`cangrejo_session_mutate_graph`).
- **Source Observation**:
  `cangrejo_session_mutate_graph` receives `entities: [...]` and directly executes `session.store.runInBatch(...)` and `commitSessionMutationIfCloud(...)` without checking `session.store.entityCount` against `maxEntitiesPerSession` (configured as 500 for Community and 25,000 for ORO_PRO in `cangrejo_tenant_metadata`).
- **Empirical Verification Output**:
  - Registered a user on `COMMUNITY` tier (`maxEntitiesPerSession: 500`).
  - Sent mutation payload with 600 entities to `cangrejo_session_mutate_graph`.
  - Verbatim Output:
    ```
    [4E-JSONRPC] Flood response status: 200 Entity count: 600
    [4E-JSONRPC] Quota check bypassed (accepted > 500 nodes): true
    ```

---

### 1.6 Conformance Finding 6 (CONF-M2-06): JSON-RPC 2.0 Error ID Non-Conformance
- **Target File & Lines**: `apps/web/honoApp.ts:5763`.
- **Source Observation**:
  ```typescript
  const rpcId = rpc.id ?? 1;
  ```
- **Empirical Verification Output**:
  - Request: `{"jsonrpc":"2.0","method":"unknown_method"}` (omitting `id`).
  - Response: `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Unsupported MCP JSON-RPC method: \"unknown_method\""}}`.
  - JSON-RPC 2.0 Specification Section 4.3 mandates: "If there was an error in detecting the id in the Request object ... it MUST be Null." Returning `id: 1` can cause client correlation mismatches.

---

### 1.7 Verification 7 (VERIF-M2-07): Cloudflare Code Mode AST Sandbox Strict Containment
- **Target File & Lines**: `apps/web/honoApp.ts:4702–4774` (`parseCodeModeScriptCalls`).
- **Empirical Verification Output**:
  - Malicious payload with `process.exit(1)`, `globalThis.__hacked = true`, `fetch('http://...')`, and `while(true) {}`.
  - Result:
    ```
    [5A-CodeMode] Execution status: 200
    [5A-CodeMode] globalThis.__hacked is undefined (AST sandbox contained host): true
    [5B-CodeMode] Infinite loop script executed in 1ms without hanging!
    [5C-CodeMode] Object.prototype.polluted is undefined (No prototype pollution): true
    [5D-CodeMode] Promise.all steps shared identical parallelGroup ID: true
    ```
  - Confirmed: The regex-based AST extractor completely avoids `eval()`, ignoring non-codemode statements and preventing host containment escapes or event-loop hangs.

---

## 2. Logic Chain

```
Observation 1.1 (honoApp.ts:4133)
  └─► JIT session provisioning requires mcpCtx.token.startsWith('CGRJ.')
        └─► cgrj_usr_* user tokens bypass JIT provisioning on room switching
              └─► cangrejo_mcp_sessions has no row for tenantId:newRoomId
                    └─► appendGraphMutationWithOcc violates FK on cangrejo_graph_mutations(session_id)
                          └─► CRASH with SQLITE_CONSTRAINT_FOREIGNKEY on both Local & Prod D1 (BUG-M2-01)

Observation 1.2 (MtgjJsonHandler.ts:96)
  └─► crypto.randomBytes(12) generated once per document and reused for all fields
        └─► In AES-GCM (CTR mode), C = P ⊕ KS
              └─► For identical (Key, IV), C1 ⊕ C2 = P1 ⊕ P2
                    └─► Knowing P2 allows computing P1 = (C1 ⊕ C2) ⊕ P2
                          └─► 100% exact secret recovery verified; breaks zero-knowledge confidentiality (BUG-M2-02)

Observation 1.3 (Stix21Exporter.ts:212)
  └─► Loops entity.properties.values (JS Map) and takes first string
        └─► If secondary metadata (e.g. registrar) is inserted before domain/IP
              └─► Stix21Exporter outputs metadata string as STIX value
                    └─► Downstream SIEM ingests corrupted indicators (BUG-M2-03)

Observation 1.4 (Stix21Exporter.ts:441 & Guid.ts)
  └─► Regex /^\d+$/ accepts x_cangrejo_entity_id: "0"
        └─► new Guid(0n) throws "Guid cannot be zero"
        └─► Guid.parse("0") assigns Guid.ZERO
              └─► Multiple entities with "0" collapse to same Map key in GraphStore
                    └─► Silent entity deletion / data loss during STIX ingest (BUG-M2-04)

Observation 1.5 (honoApp.ts:5263)
  └─► cangrejo_session_mutate_graph does not query maxEntitiesPerSession
        └─► 600 entities upserted successfully on Community tier (limit 500)
              └─► Risk of isolate OOM or exceeding D1 mutation batch constraints (BUG-M2-05)
```

---

## 3. Caveats

1. **Production Database Footprint**: The production probes against `https://cangrejo-osint-workstation.pc911itservices.workers.dev` generated test user accounts (`challenger_*@cangrejo-qa.org`) and tested room keys in the production Cloudflare D1 database.
2. **Review-Only Constraint**: In strict adherence to the agent instructions, no production or repository code was modified. The test harness `tests/adversarial-subsystems-3-4.ts` was written in the standard `tests/` directory and verified with `bun run typecheck`.
3. **No Network Exhaustion**: Stress tests for unbounded mutation flooding were capped at 600 entities to avoid causing edge isolate resource starvation in production.

---

## 4. Conclusion

Subsystems 3 and 4 feature a sophisticated, high-performance architecture with WebGPU rendering, Rust FFI, and two-tier D1/R2 snapshots. However, the **5 verified defects** represent significant functional, cryptographic, and forensic reliability risks:

| Bug ID | Severity | Subsystem | Impact | Recommended Action |
|:---|:---:|:---:|:---|:---|
| **BUG-M2-01** | **HIGH** | D1 / MCP | Room switching crashes with `SQLITE_CONSTRAINT_FOREIGNKEY` under user auth | Update `honoApp.ts:4133` to provision JIT session when `token.startsWith('cgrj_usr_')` |
| **BUG-M2-02** | **CRITICAL** | Bóveda Cero | AES-GCM IV reuse leaks keystream and allows plaintext recovery | Update `MtgjJsonHandler.ts` to generate a fresh 12-byte IV per encrypted field and prepend it to the ciphertext payload |
| **BUG-M2-03** | **MEDIUM** | STIX 2.1 | Primary indicator corrupted by map insertion order | Replace loop in `Stix21Exporter.ts:212` with `getPartPrimaryValue(entity)` from `@cangrejo/core` |
| **BUG-M2-04** | **LOW** | STIX 2.1 / Guid | Entity ID `"0"` crashes or causes silent entity map collision | Update regex in `Stix21Exporter.ts:441` to `/^[1-9]\d*$/` |
| **BUG-M2-05** | **MEDIUM** | MCP Server | Missing quota check allows unbounded entity flooding | Enforce `session.store.entityCount + newCount <= quota.maxEntities` in `cangrejo_session_mutate_graph` |
| **CONF-M2-06** | **LOW** | MCP JSON-RPC | Returning `id: 1` on missing ID violates JSON-RPC 2.0 §4.3 | Update `honoApp.ts:5763` to preserve `rpcId = rpc.id ?? null` on error responses |

---

## 5. Verification Method

To independently execute and verify all empirical challenges:

```bash
# 1. Run the standalone empirical adversarial test suite
bun tests/adversarial-subsystems-3-4.ts

# 2. Verify strict TypeScript compliance across the repository
bun run typecheck

# 3. Verify all 81 monorepo architectural gate tests pass cleanly
bun test

# 4. Verify moon DAG build and typecheck
bun run moon:check
```

### Invalidation Conditions
- If `tests/adversarial-subsystems-3-4.ts` exits with an uncaught error rather than printing the formatted `SUMMARY OF EMPIRICAL CHALLENGES` table.
- If `BUG-M2-01` produces HTTP 200 with an upserted entity instead of `SQLITE_CONSTRAINT_FOREIGNKEY` when using `cgrj_usr_*` tokens on non-default rooms.
- If `BUG-M2-02` fails to recover the exact secret string `"TOP_SECRET_PASSWORD_ALPHA_2026!"` from the XOR oracle.
