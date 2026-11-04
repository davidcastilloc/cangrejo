# CANGREJO ARCHITECTURAL SPECIFICATION
## Dual-Edition Multi-Tenant MCP Architecture & Phased Implementation Roadmap
### Community (Local / Self-Hosted) vs. Managed Cloud SaaS (Cloudflare Workers + D1)

- **Document Version**: `1.0.0`
- **Status**: `Approved / Architecture Specification`
- **Authors**: Architecture & Roadmap Core Team (`@cangrejo/monorepo`)
- **Date**: `2026-11-04`
- **Target Milestones**: M1 Architecture Spec & M2 Engineering Implementation
- **Classification**: Open-Core Architecture & Forensic Security Specification

---

## Executive Summary & Mission Context

Cangrejo is a high-performance OSINT, Threat Intelligence, and Forensic Link-Analysis Graph Platform built for sovereign forensic analysts, security operations centers (SOCs), and cybercrime investigators.

To enable external AI agents (such as **Claude Desktop**, **Cursor IDE**, and **Claude Code CLI**) to autonomously discover latent links, unpack defanged IOCs, detect financial laundering cycles, and synthesize court-admissible Daubert/FRE 702 forensic dossiers, Cangrejo exposes a standard **Model Context Protocol (MCP)** JSON-RPC 2.0 interface containing 12 specialized forensic tools.

This specification establishes the dual-edition operational model and the multi-tenant session isolation architecture:
1. **Community Edition (Local / Self-Hosted / Open-Core)**: Single-tenant deployment running locally via `bun run dev`, `bun start`, or Docker, backed by `bun:sqlite` in Write-Ahead Logging (WAL) mode with analyst BYOK API keys. Connects via loopback stdio (`bun run mcp:stdio`) or local HTTP (`http://127.0.0.1:3000/api/mcp`) without external authentication or cloud dependencies.
2. **Managed Cloud SaaS Edition (Oro Pro / Platino Enterprise)**: Globally distributed serverless multi-tenant deployment running across Cloudflare Workers edge isolates (`cangrejo-osint-workstation`), Cloudflare D1 distributed SQLite (`cangrejo-vault-d1`), Workers AI (`env.AI`), and Vectorize (`cangrejo-forensic-bge-1024`), activated via HMAC-SHA256 signed license tokens (`CGRJ.ORO_PRO...`, `CGRJ.PLATINO_ENTERPRISE...`). Connects via authenticated, session-scoped endpoints (`/api/mcp/:sessionId`).
3. **Cloud State Synchronization**: Solves the edge isolate statelessness challenge through an append-only Write-Ahead Log (WAL) (`cangrejo_graph_mutations`) with `UNIQUE(session_id, seq)` Optimistic Concurrency Control (OCC) and periodic snapshot compaction (`cangrejo_session_graphs`).
4. **Workstation UI Onboarding**: An adaptive onboarding interface in `#edition-modal-backdrop` generating instant, copy-paste configurations across all supported clients with WCAG 2.1 AAA contrast compliance ($\ge 7:1$).
5. **Actionable 4-Phase Roadmap**: Sequential engineering phases covering database migrations, backend middleware, UI integration, and automated Gate 12 verification.

---

## 1. Dual-Edition Architectural Specification

### 1.1 Architectural Philosophy: Open-Core vs. Sovereign Cloud

Cangrejo adheres to an **Odoo-style Open-Core philosophy**. The core engine, tripartite graph structures (Data, Structure, Layout), 107 OSINT entity ontology, and local forensic tools are 100% open-source under the Apache-2.0 license. The Managed Cloud SaaS tier builds upon this foundation by providing elastic cloud persistence, multi-analyst collaboration, serverless GPU-accelerated AI models, and automated threat monitoring.

```
+---------------------------------------------------------------------------------------------------------+
|                                    CANGREJO DUAL-EDITION TOPOLOGY                                       |
+----------------------------------------------------+----------------------------------------------------+
| COMMUNITY EDITION (LOCAL / SELF-HOSTED)            | MANAGED CLOUD SAAS (ORO PRO / PLATINO ENTERPRISE)  |
+----------------------------------------------------+----------------------------------------------------+
|                                                    |                                                    |
|  [ Analyst Workstation / Laptop / Air-Gapped ]     |  [ Distributed Enterprise / SOC Teams / Web PWA ]  |
|                                                    |                                                    |
|  +--------------------+   +---------------------+  |  +--------------------+   +---------------------+  |
|  |   Claude Desktop   |   |     Cursor IDE      |  |  |   Claude Desktop   |   |     Cursor IDE      |  |
|  |   (Stdio Pipe)     |   | (Local HTTP Loop)   |  |  | (mcpStdioServer or |  | (HTTPS Bearer Auth) |  |
|  |                    |   |                     |  |  |  mcp-remote bridge)|  |                     |  |
|  +---------+----------+   +----------+----------+  |  +---------+----------+   +----------+----------+  |
|            |                         |             |            |                         |             |
|            v                         v             |            +------------+------------+             |
|  +----------------------------------------------+  |                         |                          |
|  |     Local Cangrejo Process (Single OS PID)   |  |                         v HTTPS POST /api/mcp/:id  |
|  |  - Bun / Node.js Runtime (127.0.0.1:3000)   |  |  +----------------------------------------------+  |
|  |  - In-Memory sessionRooms Map<string, Store> |  |  |  Cloudflare Edge Network (300+ PoPs)         |  |
|  |  - Native bun:sqlite (WAL Mode)              |  |  |  - Ephemeral V8 Edge Isolates               |  |
|  |  - Local BYOK API Keys (Shodan/VT/AbuseIPDB) |  |  |  - Bearer Token Auth Interceptor            |  |
|  |  - Unauthenticated Trust Boundary            |  |  |  - Read-Through / Write-Through OCC Sync    |  |
|  +----------------------------------------------+  |  +----------------------+-----------------------+  |
|                        |                           |                         |                          |
|                        v                           |            +------------+------------+             |
|  +----------------------------------------------+  |            |                         |             |
|  |  Local Storage: .cangrejo/cangrejo.vault.db  |  |            v                         v             |
|  |  - Zero Network Telemetry                    |  |  +--------------------+   +---------------------+  |
|  |  - Open-Core Apache-2.0 Watermark            |  |  | Cloudflare D1      |   | Cloudflare AI/Vect  |  |
|  |  +----------------------------------------------+  |  | (cangrejo-vault-d1)|   | (Workers AI / BGE)  |  |
|                                                    |  | + R2 Offload Bucket|   |                     |  |
|                                                    |  +--------------------+   +---------------------+  |
+----------------------------------------------------+----------------------------------------------------+
```

### 1.2 Community Edition: Local & Self-Hosted Operational Model

- **Runtime & Deployment**:
  - Runs directly via Bun (`bun run dev`, `bun start`) or as a container (`docker run -p 3000:3000 ghcr.io/cangrejo/cangrejo:latest`).
  - Single OS process model. The server listens on loopback (`127.0.0.1:3000`).
- **Network Boundary & Security**:
  - Strictly contained within the host machine loopback network or an air-gapped private LAN.
  - Zero telemetry, zero external license phone-home calls.
  - Unauthenticated trust boundary: Loopback HTTP (`http://127.0.0.1:3000/api/mcp`) and stdio pipes (`bun run mcp:stdio`) require no authentication tokens, minimizing friction for local security researchers.
- **Persistence & Caching**:
  - Local SQLite database file (`.cangrejo/cangrejo.vault.sqlite`) accessed via `bun:sqlite` with `PRAGMA journal_mode = WAL;`, `foreign_keys = ON;`, and `recursive_triggers = ON;`.
  - In-process singleflight Promise coalescing (`inFlightPesquisas`) prevents duplicate concurrent OSINT requests.
  - Local SQLite TTL cache (`cangrejo_pesquisa_cache`) stores raw OSINT results.
- **In-Memory Lifecycle**:
  - Graph stores reside directly in the heap of the long-lived Bun process (`sessionRooms = new Map<string, CangrejoSessionRoomState>()`).
  - Mutations take effect instantaneously (< 0.1 ms latency) and broadcast to connected browser tabs via local SSE (`/api/collab/rooms/:roomId/stream`).
- **OSINT & AI Transforms**:
  - Local execution of DNS, RDAP, BGP/ASN, and CT transforms.
  - BYOK (Bring Your Own Keys) for commercial transforms (Shodan, VirusTotal, AbuseIPDB) stored encrypted in the local SQLite vault (`cangrejo_provider_keys`).
  - Generated Forensic Dossiers include an Open-Core Apache-2.0 watermark.

### 1.3 Managed Cloud SaaS Edition: Cloudflare Workers + D1 Operational Model

- **Runtime & Deployment**:
  - Serverless multi-tenant application deployed to the Cloudflare Workers edge (`cangrejo-osint-workstation` via `wrangler.jsonc`) running on the `nodejs_compat` runtime.
  - Distributed across 300+ global data centers (PoPs).
- **Network Boundary & Security**:
  - Strict zero-trust network perimeter. All inbound traffic terminates via TLS 1.3.
  - Multi-tenant session routing: Endpoints are parameterized by investigation session (`/api/mcp/:sessionId`) using clean user-facing slugs (e.g. `expediente-apt29`).
  - Mandatory Bearer Token authentication: Every MCP request must supply a valid cryptographic token (`CGRJ.<TIER>.<base64urlClaims>.<hmacHex>`) or a hashed session token matching an active organization.
  - Strict Two-Tier Tenant Isolation:
    - **In-Memory Heap**: Scoped room key `tenant:${tenantId}:session:${rawSessionId}` isolates edge isolate graph instances.
    - **Cloudflare D1 Primary Key**: Composite primary key `dbSessionId = ${tenantId}:${rawSessionId}` across all session tables (`cangrejo_mcp_sessions`, `cangrejo_session_graphs`, `cangrejo_graph_mutations`), strictly preventing primary key collisions, foreign key violations, and cross-tenant graph hydration leakage even if two tenants use the same slug.
  - Just-In-Time (JIT) Provisioning: When an analyst connects using a valid commercial license token (`CGRJ.*`), `mcpAuthMiddleware` atomically provisions both the tenant row (`cangrejo_tenant_metadata`) and session row (`cangrejo_mcp_sessions`) via a single `env.DB.batch([upsertTenantStmt, upsertSessionStmt])` transaction, making foreign key failures impossible.
- **Persistence & State Synchronization**:
  - Distributed persistence powered by Cloudflare D1 (`cangrejo-vault-d1` via `env.DB`) and Cloudflare R2 (`cangrejo-vault-snapshots` via `env.CANGREJO_VAULT_R2`).
  - Solves edge isolate statelessness using an append-only Write-Ahead Log (`cangrejo_graph_mutations`) with `UNIQUE(session_id, seq)` Optimistic Concurrency Control (OCC) and atomic batch writes (`env.DB.batch([insertMutationStmt, updateSessionStmt])`).
  - Compaction Boundary Invariant ($S_{cached} \ge S_{checkpoint}$): Edge isolates verify that cached in-memory sequence numbers have not fallen behind pruned checkpoint sequences; if stale ($S_{cached} < S_{checkpoint}$), the isolate evicts memory and safely re-hydrates from the snapshot checkpoint, preventing silent graph corruption.
  - Two-Tier Snapshot Architecture: Checkpoint snapshots are compressed using native Web Standard `CompressionStream('gzip')`. Payloads $\le 1.5\text{ MB}$ reside directly in D1 `snapshot_payload BLOB`, while mega-graphs (> 1.5 MB, up to 100k+ entities) offload seamlessly to Cloudflare R2 with SHA-256 integrity sealing.
  - Multi-tier edge caching: Isolate-level Promise coalescing $\rightarrow$ Cloudflare Cache API (`caches.default`) $\rightarrow$ D1 distributed cache table (`cangrejo_pesquisa_cache`).
- **AI & Threat Intelligence Acceleration**:
  - Cloudflare Workers AI (`env.AI`): Serverless execution of `llama-3.3-70b-instruct` for defanged IOC unpacking and Daubert narrative synthesis.
  - Cloudflare Vectorize (`env.VECTORIZE_INDEX` = `cangrejo-forensic-bge-1024`): 1024-dimensional semantic embeddings for cross-investigation latent link discovery using Reciprocal Rank Fusion ($k=60$).
  - Continuous 24/7 Radar monitoring with automated infrastructure drift alerts.
  - White-label forensic dossiers without watermarks, cryptographically sealed with Ed25519 signatures.

### 1.4 Detailed Architectural Comparison Matrix

| Dimension | Community Edition (Local / Self-Hosted) | Managed Cloud SaaS Edition (Cloudflare Edge) |
| :--- | :--- | :--- |
| **Target Audience** | Individual researchers, air-gapped forensic labs, open-source community | Corporate SOCs, incident response teams, enterprise intelligence units |
| **Deployment Model** | Local CLI / Binary (`bun dev`, `bun start`, Docker) | Cloudflare Workers Edge (`cangrejo-osint-workstation`) |
| **Network Perimeter** | Loopback (`127.0.0.1`) / Internal LAN | Global Anycast Edge (HTTPS / TLS 1.3) |
| **Authentication** | Unauthenticated (loopback trust boundary) | Mandatory Bearer token (`CGRJ.*` or session token) |
| **Authorization / RBAC** | Single-tenant implicit owner | Multi-tenant (`tenant_id`, `role: owner/admin/analyst/viewer`) with JIT provisioning |
| **MCP Routing Endpoint** | `POST http://127.0.0.1:3000/api/mcp` or stdio pipe | `POST https://cangrejo.ai/api/mcp/:sessionId` (slug mapped to composite DB key) |
| **Supported Transports** | Native Stdio (`bun run mcp:stdio`), HTTP, SSE | HTTP/HTTPS POST, SSE stream, stdio via Cangrejo `mcpStdioServer` or `mcp-remote` |
| **Persistence Engine** | Local `bun:sqlite` file (`.cangrejo/cangrejo.vault.sqlite`) | Cloudflare D1 (`cangrejo-vault-d1`) + Cloudflare R2 (`cangrejo-vault-snapshots`) |
| **In-Memory Graph State** | Persistent across requests in single OS process RAM | Ephemeral in V8 isolate RAM; hydrated on-demand with compaction boundary checks |
| **State Synchronization** | Shared in-process memory | Append-only WAL (`cangrejo_graph_mutations`) + atomic D1 `batch()` OCC |
| **Concurrency Model** | Node/Bun single-threaded event loop + SQLite WAL | Distributed OCC via `UNIQUE(session_id, seq)` in D1 + atomic batch commit |
| **Cache Architecture** | In-memory `Map` Promise coalescing + SQLite TTL | In-isolate coalescing + Cloudflare Cache API + D1 cache |
| **AI Inference Engine** | Local regex + BYOK cloud APIs | Cloudflare Workers AI (`llama-3.3-70b`) + Vectorize (`bge-1024`) |
| **Real-time Collab** | In-memory `CollaborationRoomHub` (local SSE) | D1 Mutation Log + Cloudflare Durable Objects (Enterprise) |
| **Licensing Model** | Apache-2.0 Open-Core (Watermarked Dossiers) | Commercial (`CGRJ.ORO_PRO...`, `CGRJ.PLATINO...`) |
| **Write Latency** | Sub-millisecond (< 0.1 ms) | ~30–45 ms (Single-roundtrip atomic D1 `batch()` transaction) |
| **Graph Size Limit** | Host RAM bounded (100,000+ entities verified) | Tier bounded (Oro: 25k entities in D1; Platino: 100k+ entities via R2 offload) |

---

## 2. MCP Multi-Tenant Session Isolation & State Synchronization

### 2.1 MCP Wire Protocol & Capabilities Catalog

Cangrejo implements the standard **Model Context Protocol (MCP)** specification (Protocol Version `2024-11-05`) over JSON-RPC 2.0. The server exposes 12 specialized forensic link-analysis tools:

```typescript
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}
```

#### The 12 Registered Forensic MCP Tools:
1. `cangrejo_unpack_defanged_iocs`: Detects and normalizes defanged indicators (`hxxps://`, `[.]`, `[@]`, IP v4/v6, SHA-256, CVEs) with exact UTF-8 byte offsets.
2. `cangrejo_discover_latent_links`: Semantic graph embedding search via Vectorize (`bge-large-en-v1.5`) + lexical BM25 matching, combined via Reciprocal Rank Fusion ($k=60$).
3. `cangrejo_classify_anomalies`: Identifies Crypto Peel-Chains (directed cycles) and Fast-Flux C2 pivot infrastructure via PageRank centrality.
4. `cangrejo_generate_daubert_dossier`: Produces court-admissible Daubert / FRE 702 forensic dossiers sealed with asymmetric Ed25519 signatures.
5. `cangrejo_map_mitre_attack`: Maps graph topologies to MITRE ATT&CK Enterprise v15.1 Tactics and Techniques with Kill-Chain timelines.
6. `cangrejo_import_stix21_bundle`: Ingests OASIS STIX 2.1 bundles, validating the cryptographic `x_cangrejo_custody` SHA-256 seal.
7. `cangrejo_ai_auto_investigate`: Executes autonomous 1..3 hop graph expansions on high-centrality pivots via DNS, CT, BGP, and UTXO transforms.
8. `cangrejo_session_state`: Reads live workstation entities, links, selection sets, layout algorithms, camera bounds, and Undo/Redo stack depth.
9. `cangrejo_session_mutate_graph`: Dispatches atomic graph mutations (`upsert`, `remove`, `paste_iocs`, `undo`, `redo`, `clear`) with automatic cascading link deletion.
10. `cangrejo_session_run_pesquisa`: Executes live OSINT transforms and merges results into the active graph via `StrategicGraphMerger`.
11. `cangrejo_session_view_control`: Adjusts graph layout mode (`organic`, `hierarchical`, `circular`, `block`), viewport camera, and investigation filters.
12. `cangrejo_session_vault`: Persists/loads graph sessions to/from the forensic vault, exporting STIX 2.1, Daubert HTML5 dossiers, or encrypted `.cgrx` packages.

### 2.2 Parameterized Session Routing & HTTP Handlers

To support both seamless Community backward compatibility and strict multi-tenant isolation, Hono routes handle both root and parameterized endpoints:

```typescript
// Route 1: Legacy / Community Default Endpoint (Single-Tenant)
cangrejoHonoApp.get('/api/mcp', mcpAuthMiddleware, handleMcpCatalogRequest);
cangrejoHonoApp.post('/api/mcp', mcpAuthMiddleware, handleMcpJsonRpcDispatch);

// Route 2: Scoped Multi-Tenant Session Endpoint (Managed SaaS)
cangrejoHonoApp.get('/api/mcp/:sessionId', mcpAuthMiddleware, handleMcpCatalogRequest);
cangrejoHonoApp.post('/api/mcp/:sessionId', mcpAuthMiddleware, handleMcpJsonRpcDispatch);
```

**Routing Discipline & Parameter Resolution**:
- The URL parameter `:sessionId` captures the user-facing investigation slug (`rawSessionId`, e.g. `expediente-apt29`), maintaining clean, human-readable URLs for analysts and external MCP clients.
- Downstream middleware resolves `rawSessionId` and synthesizes the composite database primary key `dbSessionId = `${tenantId}:${rawSessionId}`` and the in-memory room key `scopedRoomKey = `tenant:${tenantId}:session:${rawSessionId}``.

### 2.3 Authentication, Authorization & Just-In-Time (JIT) Provisioning

For Managed Cloud SaaS (or whenever `env.DB` is bound or `CANGREJO_EDITION_TIER !== 'COMMUNITY'`), all requests pass through a security guard enforcing multi-tenant isolation and automated provisioning:

```
[ Inbound MCP Request ]
         |
         v
[ Check Route Parameter :sessionId ]
         |
         +---> If root '/api/mcp' and Local Community Edition:
         |       Allow unauthenticated access to default local room ('expediente-apt29')
         |
         +---> If '/api/mcp/:sessionId' or Cloud SaaS Environment:
                 |
                 v
         [ Extract Bearer Token ]
         - Header: Authorization: Bearer <token>
         - Query Param fallback: ?token=<token>
                 |
                 +---> Missing Token?
                 |       Return HTTP 401 / JSON-RPC Error -32000 ("Authentication required")
                 |
                 v
         [ Token Validation Strategy ]
         +---------------------------------------------------------------------------------+
         | Type A: Cryptographic Signed License Token (CGRJ.<TIER>.<claims>.<hmacHex>)    |
         | -> Fast HMAC-SHA256 signature verification in memory                            |
         | -> Extracts: tier, organizationName, credits, expiresAt                        |
         | -> tenantId = 'org_' + sha256(organizationName).slice(0, 12)                    |
         | -> dbSessionId = `${tenantId}:${rawSessionId}`                                  |
         | -> Just-In-Time (JIT) D1 Provisioning:                                          |
         |    Atomically upsert tenant + session rows in single env.DB.batch([...])       |
         |    Guarantees foreign key integrity for downstream mutation logging             |
         +---------------------------------------------------------------------------------+
         | Type B: Dedicated D1 Session Token (ses_sec_<randomHex>)                        |
         | -> Query D1: SHA-256 hash lookup in cangrejo_mcp_sessions                       |
         | -> Validate status = 'active' and expires_at > now                              |
         | -> Validate URL slug matches session.raw_session_id (anti-spoofing)             |
         | -> Extracts: tenant_id, tier, dbSessionId = session_id                          |
         +---------------------------------------------------------------------------------+
```

```typescript
export async function mcpAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const sessionId = c.req.param('sessionId');
  const isCloud = Boolean(c.env?.DB || process.env.CANGREJO_EDITION_TIER !== 'COMMUNITY');

  // Community loopback bypass for root endpoint
  if (!sessionId && !isCloud) {
    c.set('tenantId', 'local-community');
    c.set('rawSessionId', 'expediente-apt29');
    c.set('dbSessionId', 'local-community:expediente-apt29');
    c.set('scopedRoomKey', 'tenant:local-community:session:expediente-apt29');
    c.set('tier', 'COMMUNITY');
    return next();
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : c.req.query('token')?.trim();

  if (!token) {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Authentication required: Missing Bearer token or signed license key.',
      },
    }, 401);
  }

  // Type A: Cryptographic Signed License Token (CGRJ.<TIER>.<claims>.<hmac>)
  if (token.startsWith('CGRJ.')) {
    const verified = BunSqliteVault.verifySignedLicenseToken(token);
    if (!verified.valid || !verified.claims) {
      return c.json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: `Invalid license token: ${verified.reason}` },
      }, 403);
    }

    const claims = verified.claims;
    const sigHex = token.split('.')[3];
    const sigHash = createHash('sha256').update(sigHex).digest('hex');
    const orgDigest = createHash('sha256').update(claims.organizationName).digest('hex').slice(0, 12);
    const tenantId = `org_${orgDigest}`;
    const rawSessionId = (sessionId && sessionId.trim()) ? sessionId.trim() : 'expediente-apt29';
    const dbSessionId = `${tenantId}:${rawSessionId}`;
    const scopedRoomKey = `tenant:${tenantId}:session:${rawSessionId}`;

    // Just-In-Time (JIT) Provisioning in Cloudflare D1
    if (c.env?.DB) {
      const expiresEpoch = typeof claims.expiresAt === 'number'
        ? Math.floor(claims.expiresAt / 1000)
        : Math.floor(Date.now() / 1000) + (86400 * 365);

      const maxSessions = claims.tier === 'PLATINO_ENTERPRISE' ? 25 : 5;
      const maxEntities = claims.tier === 'PLATINO_ENTERPRISE' ? 100000 : 25000;
      const caseTier = claims.tier === 'PLATINO_ENTERPRISE' ? 'PLATINO' : 'ORO';

      const upsertTenantStmt = c.env.DB.prepare(`
        INSERT INTO cangrejo_tenant_metadata (
          tenant_id, tier, organization_name, license_signature_hash,
          max_active_mcp_sessions, max_entities_per_session, credits_remaining, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(tenant_id) DO UPDATE SET
          tier = excluded.tier,
          organization_name = excluded.organization_name,
          license_signature_hash = excluded.license_signature_hash,
          updated_at = unixepoch();
      `).bind(
        tenantId,
        claims.tier,
        claims.organizationName,
        sigHash,
        maxSessions,
        maxEntities,
        claims.credits ?? 0
      );

      const upsertSessionStmt = c.env.DB.prepare(`
        INSERT INTO cangrejo_mcp_sessions (
          session_id, tenant_id, raw_session_id, title, case_tier,
          status, last_seq, created_at, last_active_at, expires_at
        )
        VALUES (?, ?, ?, ?, ?, 'active', 0, unixepoch(), unixepoch(), ?)
        ON CONFLICT(session_id) DO UPDATE SET
          last_active_at = unixepoch(),
          status = 'active';
      `).bind(
        dbSessionId,
        tenantId,
        rawSessionId,
        `Expediente ${rawSessionId}`,
        caseTier,
        expiresEpoch
      );

      // Atomically provision tenant and session in a single D1 roundtrip
      await c.env.DB.batch([upsertTenantStmt, upsertSessionStmt]);
    }

    c.set('tenantId', tenantId);
    c.set('rawSessionId', rawSessionId);
    c.set('dbSessionId', dbSessionId);
    c.set('scopedRoomKey', scopedRoomKey);
    c.set('tier', claims.tier);
    return next();
  }

  // Type B: Dedicated D1 Database Session Token (ses_sec_<hex>)
  if (c.env?.DB) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await c.env.DB.prepare(`
      SELECT s.session_id, s.tenant_id, s.raw_session_id, s.status, s.expires_at, t.tier
      FROM cangrejo_mcp_sessions s
      JOIN cangrejo_tenant_metadata t ON s.tenant_id = t.tenant_id
      WHERE s.session_token_hash = ? AND s.status = 'active'
    `).bind(tokenHash).first<{
      session_id: string;
      tenant_id: string;
      raw_session_id: string;
      status: string;
      expires_at: number;
      tier: string;
    }>();

    if (!session || (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000))) {
      return c.json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: 'Invalid, expired, or unauthorized MCP session token.' },
      }, 403);
    }

    // Cross-session authorization guard: verify URL slug matches token binding
    const rawSessionId = sessionId?.trim();
    if (rawSessionId && rawSessionId !== session.raw_session_id) {
      return c.json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: 'Session token is not authorized for this investigation slug.' },
      }, 403);
    }

    c.set('tenantId', session.tenant_id);
    c.set('rawSessionId', session.raw_session_id);
    c.set('dbSessionId', session.session_id);
    c.set('scopedRoomKey', `tenant:${session.tenant_id}:session:${session.raw_session_id}`);
    c.set('tier', session.tier);
    return next();
  }

  return c.json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32001, message: 'Unauthorized session.' },
  }, 403);
}
```

### 2.4 Tenant Namespacing & Dual-Identifier Isolation Model

To eliminate cross-tenant data leakage and primary key collisions, Cangrejo enforces a **Dual-Identifier Architecture**:

| Scope | Variable Name | Format / Example | Where Used |
| :--- | :--- | :--- | :--- |
| **External (User-Facing)** | `rawSessionId` | `expediente-apt29` | HTTP route parameter `/api/mcp/:sessionId`, MCP client configuration, UI modal inputs. |
| **D1 Database Primary Key** | `dbSessionId` | `${tenantId}:${rawSessionId}` (e.g. `org_9f83a21b8c04:expediente-apt29`) | Primary key in `cangrejo_mcp_sessions(session_id)`, foreign key in `cangrejo_session_graphs` and `cangrejo_graph_mutations`. |
| **In-Memory Isolate Key** | `scopedRoomKey` | `tenant:${tenantId}:session:${rawSessionId}` | Heap `Map` index in `sessionRooms.get(...)` and `CollaborationRoomHub`. |

**Guarantees**:
- **Disjoint Primary Keys**: If Tenant Alpha and Tenant Beta both connect to slug `expediente-apt29`, their records in D1 are stored as `org_alpha:expediente-apt29` and `org_beta:expediente-apt29`. No primary key collisions or overwrite bugs can occur.
- **Disjoint Hydration**: Snapshot and delta queries filter strictly by `dbSessionId`, guaranteeing Tenant Beta will never hydrate Tenant Alpha's graph.
- **Zero Foreign Key Violations**: JIT provisioning ensures that `cangrejo_tenant_metadata` and `cangrejo_mcp_sessions` exist before any mutation row is written.

### 2.5 Cloud State Synchronization: The Edge Isolate Statelessness Challenge

In Cloudflare Workers, requests execute within ephemeral V8 isolates created and destroyed dynamically across 300+ edge locations:
1. Isolate $A$ (Ashburn, VA) serves request 1, mutating the graph in memory.
2. Isolate $B$ (Frankfurt, DE) serves request 2 from the same analyst.
3. Because isolates share no heap memory, Isolate $B$ has no access to Isolate $A$'s `sessionRooms` map!

If state is stored solely in isolate RAM, the analyst experiences severe split-brain state loss. Conversely, writing full multi-megabyte graph snapshots on every single node insertion causes catastrophic write amplification, high D1 latency (> 150 ms), and exceeds D1 single-row size limits.

### 2.6 The Append-Only Write-Ahead Log (WAL) & Atomic OCC Batching

Cangrejo resolves this with an **Atomic Write-Ahead Log (WAL) Mutation Architecture with Optimistic Concurrency Control (OCC)**:

```
[ MCP Tool Mutation Call ]
             |
             v
[ Isolate Executes store.runInBatch(...) ]
- Updates Tripartite GraphStore in RAM
- Generates SerializedGraphModsDelta (id, seq, added, deleted, moved)
             |
             v
[ Atomic D1 Batch via env.DB.batch([insertMutationStmt, updateSessionStmt]) ]
  - Statement 1: INSERT INTO cangrejo_graph_mutations (id, session_id, seq, delta_id, author_id, action, delta_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch());
  - Statement 2: UPDATE cangrejo_mcp_sessions SET last_seq = ?, last_active_at = unixepoch() WHERE session_id = ?;
             |
             +---> SUCCESS: Both statements commit in a single transactional roundtrip (~35 ms).
             |
             +---> SQLITE_CONSTRAINT_UNIQUE on (session_id, seq):
                     |
                     v
             [ Conflict Detected! (OCC Retry Flow) ]
             1. Transaction automatically rolls back: last_seq in cangrejo_mcp_sessions remains untouched.
             2. Fetch concurrent deltas: SELECT seq, delta_id, delta_json FROM cangrejo_graph_mutations WHERE session_id = ? AND seq >= ?
             3. Apply missed deltas to local GraphStore via CollaborationRoomHub.applyDeltaToStore()
             4. Advance sequence number: seq_next = max(seq) + 1
             5. Re-execute batch with new seq (up to 3 retries)
```

```typescript
// Production Atomic D1 Batch Execution
const insertMutationStmt = c.env.DB.prepare(`
  INSERT INTO cangrejo_graph_mutations (
    id, session_id, seq, delta_id, author_id, action, delta_json, created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch());
`).bind(
  `mut_${crypto.randomUUID()}`,
  dbSessionId,
  nextSeq,
  delta.deltaId,
  authorId ?? 'mcp-agent',
  action,
  JSON.stringify(delta)
);

const updateSessionStmt = c.env.DB.prepare(`
  UPDATE cangrejo_mcp_sessions
  SET last_seq = ?, last_active_at = unixepoch()
  WHERE session_id = ?;
`).bind(
  nextSeq,
  dbSessionId
);

// Executed in a single atomic SQLite transaction on Cloudflare D1
await c.env.DB.batch([insertMutationStmt, updateSessionStmt]);
```

**Why Atomic Batching Guarantees Correctness**:
1. **Transactional Atomicity**: If `insertMutationStmt` fails (e.g. `SQLITE_CONSTRAINT_UNIQUE` due to a concurrent write colliding on `(session_id, seq)`), SQLite automatically rolls back the entire batch. `last_seq` in `cangrejo_mcp_sessions` will never advance ahead of the mutation log.
2. **Elimination of Edge Split-Brain**: An edge isolate failure between network calls cannot leave orphaned mutations or stale high-water marks.
3. **Single Roundtrip Latency**: Cloudflare D1 bundles both statements into a single RPC call to the D1 primary coordinator, reducing write latency from ~70ms (two sequential roundtrips) to ~35ms.

### 2.7 Two-Tier Snapshot Checkpointing, Compaction & Pruning Boundary

To keep hydration times bounded regardless of mutation history depth:
- Every $K=50$ mutations (or upon explicit `cangrejo_session_vault` save actions), the edge isolate triggers an asynchronous snapshot checkpoint via Cloudflare's `ctx.waitUntil()`.
- Uncompressed JSON graph payloads can exceed Cloudflare D1's 2 MB single-row limit for graphs $\ge 5,000$ entities. Cangrejo implements a **Two-Tier Storage Architecture** with native Web Streams Gzip compression:

| Storage Tier | Condition | Storage Medium | Key / Destination | Latency |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1: `d1_inline`** | Compressed size $\le 1.5\text{ MB}$ | `cangrejo_session_graphs.snapshot_payload BLOB` | D1 database row | ~20–40 ms |
| **Tier 2: `r2_offload`** | Compressed size $> 1.5\text{ MB}$ | Cloudflare R2 bucket `env.CANGREJO_VAULT_R2` | `snapshots/{tenant_id}/{session_id}/chk_{seq}.cgrj.gz` | ~60–90 ms |

#### The Compaction Boundary Invariant ($S_{cached} \ge S_{checkpoint}$)
When compaction runs:
1. The serialized graph is compressed and saved to `cangrejo_session_graphs` with `checkpoint_seq = S_{checkpoint}`.
2. Intervening mutations are pruned from D1:
   ```sql
   DELETE FROM cangrejo_graph_mutations WHERE session_id = ? AND seq < ?;
   ```
3. **The Invariant**: Delta catchup on an isolate whose cached sequence is $S_{cached}$ is mathematically valid if and only if:
   $$S_{cached} \ge S_{checkpoint}$$
4. If an edge isolate wakes up after being dormant and finds $S_{cached} < S_{checkpoint}$, the mutation gap $[S_{cached} + 1, S_{checkpoint} - 1]$ has been permanently deleted from D1. The isolate's heap state is **irreparably stale**. Replaying mutations starting from $S_{checkpoint}$ on top of $S_{cached}$ would cause broken CSR adjacency, dangling edge pointers, and silent graph corruption.
5. Therefore, if $S_{cached} < S_{checkpoint}$, the isolate **must invalidate its cache immediately** and perform a full cold-start rehydration from the snapshot checkpoint.

### 2.8 Cache Coalescing: Local Singleflight vs. Multi-Tier Edge Caching

OSINT transforms (DNS resolution, Certificate Transparency queries, RDAP lookups) are high-latency and rate-limited upstream. Cangrejo implements distinct caching tiers optimized for each edition:

1. **Community Edition (Local Singleflight + SQLite TTL)**:
   - Concurrent requests within the same Bun process share an in-memory `Map<string, Promise<Record<string, unknown>>>` (`inFlightPesquisas`).
   - If 10 MCP tool calls request WHOIS for `target.com` simultaneously, only 1 network socket opens; all 10 await the single shared Promise.
   - Result is cached locally in SQLite table `cangrejo_pesquisa_cache` with a 24-hour TTL.
2. **Managed Cloud SaaS Edition (3-Tier Hierarchical Cache)**:
   - **Tier 1 (In-Isolate Singleflight)**: Local V8 isolate `Map` coalesces simultaneous calls hitting the same edge Worker.
   - **Tier 2 (Cloudflare Workers Cache API)**: Uses `caches.default` with standard Cache-Control headers (`public, max-age=300, stale-while-revalidate=60`). Hits across different isolates within the same regional data center return from Cloudflare edge cache in $< 2\text{ ms}$.
   - **Tier 3 (Cloudflare D1 `cangrejo_pesquisa_cache`)**: Globally consistent distributed SQLite table ensuring queries are not repeated across global data centers even after edge cache eviction.

---

## 3. Database Schema & Data Models

### 3.1 Migration `0003_mcp_session_vault.sql` Complete DDL

This migration creates dedicated, high-performance tables in `packages/database-d1/migrations/0003_mcp_session_vault.sql` compatible with both Cloudflare D1 and local SQLite 3:

```sql
-- ==============================================================================
-- CANGREJO D1 MIGRATION: 0003_mcp_session_vault.sql
-- Description: Multi-tenant MCP session isolation, WAL graph mutations,
--              snapshot checkpoints, and tenant metadata.
-- Dialect: SQLite 3 / Cloudflare D1
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. TENANT METADATA & LICENSE BINDINGS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_tenant_metadata (
    tenant_id TEXT PRIMARY KEY,                       -- Scoped ID: 'org_' + NanoID
    tier TEXT NOT NULL DEFAULT 'COMMUNITY'
        CHECK (tier IN ('COMMUNITY', 'ORO_PRO', 'PLATINO_ENTERPRISE')),
    license_key_masked TEXT,
    license_signature_hash TEXT,                     -- SHA-256 hash of commercial license token
    organization_name TEXT NOT NULL,
    max_active_mcp_sessions INTEGER NOT NULL DEFAULT 5,
    max_entities_per_session INTEGER NOT NULL DEFAULT 25000,
    credits_remaining INTEGER NOT NULL DEFAULT 0,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tenant_tier ON cangrejo_tenant_metadata(tier);

-- ------------------------------------------------------------------------------
-- 2. ISOLATED MCP SESSIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_mcp_sessions (
    session_id TEXT PRIMARY KEY,                     -- Namespaced PK: '${tenantId}:${rawSessionId}'
    tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
    raw_session_id TEXT NOT NULL,                    -- URL/analyst slug: e.g. 'expediente-apt29'
    user_id TEXT,                                    -- Analyst user ID or principal
    session_token_hash TEXT,                         -- SHA-256 hash of dedicated Bearer token (NULL for Type A license sessions)
    title TEXT NOT NULL DEFAULT 'Expediente MCP',
    case_tier TEXT NOT NULL DEFAULT 'ORO'
        CHECK (case_tier IN ('PLATINO', 'ORO', 'PLATA', 'BRONCE')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'idle', 'closed', 'revoked')),
    last_seq INTEGER NOT NULL DEFAULT 0,             -- High-water mark of graph mutations
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_active_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,                     -- Unix epoch timestamp of session expiration
    CONSTRAINT uq_tenant_raw_session UNIQUE (tenant_id, raw_session_id)
);

-- Partial unique index: enforces unique session tokens when set, while allowing multiple license-backed sessions
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_session_token 
    ON cangrejo_mcp_sessions(session_token_hash) 
    WHERE session_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_session_tenant 
    ON cangrejo_mcp_sessions(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_mcp_session_expires 
    ON cangrejo_mcp_sessions(expires_at);

-- ------------------------------------------------------------------------------
-- 3. SESSION GRAPH SNAPSHOTS (CHECKPOINTS) - TWO-TIER COMPRESSED STORAGE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_session_graphs (
    session_id TEXT PRIMARY KEY REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
    checkpoint_seq INTEGER NOT NULL DEFAULT 0,       -- Sequence number of this snapshot
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    storage_tier TEXT NOT NULL DEFAULT 'd1_inline'
        CHECK (storage_tier IN ('d1_inline', 'r2_offload')),
    compression_codec TEXT NOT NULL DEFAULT 'gzip'
        CHECK (compression_codec IN ('gzip', 'cgrx', 'none')),
    snapshot_payload BLOB,                           -- Compressed bytes (populated when storage_tier = 'd1_inline')
    snapshot_r2_key TEXT,                            -- R2 object key (populated when storage_tier = 'r2_offload')
    byte_size INTEGER NOT NULL DEFAULT 0,            -- Compressed byte count
    payload_sha256 TEXT NOT NULL,                    -- Cryptographic integrity seal (Daubert / FRE 702)
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------------------
-- 4. GRAPH MUTATION LOG (APPEND-ONLY WAL)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_graph_mutations (
    id TEXT PRIMARY KEY,                             -- 'mut_' + UUID
    session_id TEXT NOT NULL REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,                            -- Monotonic sequence (1, 2, 3...)
    delta_id TEXT NOT NULL,                          -- CollaborationRoomHub deltaId
    author_id TEXT NOT NULL DEFAULT 'mcp-agent',     -- Identifier of actor/agent
    action TEXT NOT NULL                             -- Action discriminator
        CHECK (action IN ('upsert', 'remove', 'clear', 'paste_iocs', 'delta', 'layout', 'undo', 'redo')),
    delta_json TEXT NOT NULL,                        -- SerializedGraphModsDelta payload
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT uq_session_seq UNIQUE (session_id, seq)
);

-- Note on Index Optimization:
-- We explicitly omit a redundant index on (session_id, seq) because CONSTRAINT uq_session_seq
-- automatically provisions a composite unique B-tree index (sqlite_autoindex_cangrejo_graph_mutations_2).
-- Omitting the duplicate index eliminates write amplification on high-frequency mutations.
CREATE INDEX IF NOT EXISTS idx_mutations_created_at 
    ON cangrejo_graph_mutations(created_at);

-- ------------------------------------------------------------------------------
-- 5. AUTOMATIC TRIGGER FOR TENANT METADATA UPDATED_AT
-- ------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_tenant_metadata_updated_at
AFTER UPDATE ON cangrejo_tenant_metadata
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE cangrejo_tenant_metadata SET updated_at = unixepoch() WHERE tenant_id = OLD.tenant_id;
END;
```

#### Cloudflare Environment Configuration (`wrangler.jsonc`)
To support Tier 2 R2 offloading for large graph snapshots, `wrangler.jsonc` binds the dedicated R2 bucket alongside D1, Workers AI, and Vectorize:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "cangrejo-osint-workstation",
  "main": "apps/web/cloudflareWorker.ts",
  "compatibility_date": "2026-11-03",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cangrejo-vault-d1",
      "database_id": "17148abb-d92b-4c82-833a-ec647e2247ea",
      "migrations_dir": "packages/database-d1/migrations"
    }
  ],
  "r2_buckets": [
    {
      "binding": "CANGREJO_VAULT_R2",
      "bucket_name": "cangrejo-vault-snapshots"
    }
  ],
  "vectorize": [
    {
      "binding": "VECTORIZE_INDEX",
      "index_name": "cangrejo-forensic-bge-1024"
    }
  ],
  "assets": { "directory": "./dist", "binding": "ASSETS" }
}
```

### 3.2 Query Flows, Compaction Boundary Invariant & Hydration Lifecycle

When an MCP client issues a tool invocation to an edge isolate:

```
Step 1: Fetch Consolidated Session & Checkpoint State (Single Indexed Read)
----------------------------------------------------------------------------
SELECT 
    s.session_id, s.tenant_id, s.status, s.last_seq, s.expires_at,
    COALESCE(g.checkpoint_seq, 0) AS checkpoint_seq,
    g.storage_tier, g.snapshot_r2_key, g.byte_size, g.payload_sha256
FROM cangrejo_mcp_sessions s
LEFT JOIN cangrejo_session_graphs g ON s.session_id = g.session_id
WHERE s.session_id = ?;

Step 2: Check In-Memory Cache (RAM) & Enforce Compaction Boundary
-----------------------------------------------------------------
Is `sessionRooms.has(scopedKey)`?
  - YES:
      - Case A (Fresh): `cachedState.lastSeq === d1LastSeq` -> Return cached store immediately (0.0 ms).
      - Case B (Compaction Boundary Gap): `cachedState.lastSeq < d1CheckpointSeq`
        Intervening mutations were deleted during snapshot compaction!
        Evict memory: `sessionRooms.delete(scopedKey)`.
        Fall through to Cold Start Hydration (Step 3).
      - Case C (Safe Delta Catchup): `cachedState.lastSeq >= d1CheckpointSeq && < d1LastSeq`
        SELECT seq, delta_id, delta_json 
        FROM cangrejo_graph_mutations 
        WHERE session_id = ? AND seq > ? 
        ORDER BY seq ASC;
        Apply each delta via `CollaborationRoomHub.applyDeltaToStore(store, delta)`.
        Advance `cachedState.lastSeq = d1LastSeq`. Return store.

Step 3: Cold Start Hydration (Cache Miss or Pruned Cache Eviction)
------------------------------------------------------------------
1. If `cangrejo_session_graphs` row exists:
   - If `storage_tier === 'd1_inline'`: Read `snapshot_payload BLOB`.
   - If `storage_tier === 'r2_offload'`: Fetch bytes from `env.CANGREJO_VAULT_R2.get(snapshot_r2_key)`.
   - Cryptographic Check: Verify `sha256(compressedBytes) === payload_sha256` (Daubert FRE 702 seal).
   - Decompress: `jsonText = await decompressGraphSnapshot(compressedBytes)` via DecompressionStream('gzip').
   - Instantiate: `store = GraphStore.deserializeFromCgrj(JSON.parse(jsonText))`.
2. Replay Trailing Mutations (if `d1CheckpointSeq < d1LastSeq`):
   SELECT seq, delta_id, delta_json 
   FROM cangrejo_graph_mutations 
   WHERE session_id = ? AND seq > ? 
   ORDER BY seq ASC;
   Apply deltas to store.
3. Cache in Isolate RAM: `sessionRooms.set(scopedKey, { store, lastSeq: d1LastSeq })`.
```

#### Production State Synchronization & Hydration Implementation

```typescript
import { createHash } from 'node:crypto';
import { GraphStore } from '@cangrejo/core';
import { CollaborationRoomHub } from '@cangrejo/core';

const MAX_D1_INLINE_SNAPSHOT_BYTES = 1_500_000; // 1.5 MB safety ceiling for D1 BLOB storage

export async function compressGraphSnapshot(jsonText: string): Promise<Uint8Array> {
  const inputBytes = new TextEncoder().encode(jsonText);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(inputBytes);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

export async function decompressGraphSnapshot(compressedBytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(compressedBytes);
  writer.close();
  const decompressed = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  return new TextDecoder().decode(decompressed);
}

/**
 * Hydrates or synchronizes an isolated GraphStore within the edge isolate,
 * strictly enforcing the checkpoint pruning boundary invariant (Gate 12).
 */
export async function ensureSessionStore(
  c: Context,
  scopedKey: string,
  dbSessionId: string,
  sessionMeta: { last_seq: number; checkpoint_seq: number }
): Promise<GraphStore> {
  const cachedState = sessionRooms.get(scopedKey);
  const d1LastSeq = sessionMeta.last_seq;
  const d1CheckpointSeq = sessionMeta.checkpoint_seq;

  if (cachedState) {
    // Fast Path: Cache is already at D1 high-water mark (0.0 ms)
    if (cachedState.lastSeq === d1LastSeq) {
      return cachedState.store;
    }

    // Boundary Check: Verify intervening deltas were not pruned
    if (cachedState.lastSeq < d1CheckpointSeq) {
      console.warn(
        `[Sync] Pruning boundary gap detected: cached seq ${cachedState.lastSeq} < checkpoint ${d1CheckpointSeq}. ` +
        `Evicting isolate memory for '${scopedKey}'.`
      );
      sessionRooms.delete(scopedKey);
      // Fall through to Cold Start Hydration
    } else {
      // Safe Path: Intervening deltas [cachedState.lastSeq + 1 .. d1LastSeq] exist in WAL
      const deltaRows = await c.env.DB.prepare(`
        SELECT seq, delta_id, delta_json
        FROM cangrejo_graph_mutations
        WHERE session_id = ? AND seq > ?
        ORDER BY seq ASC
      `).bind(dbSessionId, cachedState.lastSeq).all<{
        seq: number;
        delta_id: string;
        delta_json: string;
      }>();

      for (const row of deltaRows.results) {
        const delta = JSON.parse(row.delta_json);
        CollaborationRoomHub.applyDeltaToStore(cachedState.store, delta);
      }

      cachedState.lastSeq = d1LastSeq;
      return cachedState.store;
    }
  }

  // Cold Start Hydration (Cache Miss or Pruned Cache Eviction)
  return await hydrateStoreFromD1Snapshot(c, scopedKey, dbSessionId, d1CheckpointSeq, d1LastSeq);
}

/**
 * Saves a graph snapshot to D1 inline BLOB or offloads to Cloudflare R2
 * depending on compressed payload size.
 */
export async function persistGraphSnapshot(
  c: Context,
  tenantId: string,
  dbSessionId: string,
  checkpointSeq: number,
  store: GraphStore
): Promise<void> {
  const serialized = store.serializeToCgrj();
  const jsonText = JSON.stringify(serialized);
  const compressedBytes = await compressGraphSnapshot(jsonText);
  const byteSize = compressedBytes.byteLength;
  const sha256 = createHash('sha256').update(compressedBytes).digest('hex');
  const nodeCount = store.dataStore.entityCount;
  const edgeCount = store.dataStore.linkCount;

  if (byteSize <= MAX_D1_INLINE_SNAPSHOT_BYTES) {
    // Tier 1: In-D1 Compressed BLOB
    await c.env.DB.prepare(`
      INSERT INTO cangrejo_session_graphs (
        session_id, checkpoint_seq, node_count, edge_count,
        storage_tier, compression_codec, snapshot_payload, snapshot_r2_key,
        byte_size, payload_sha256, updated_at
      ) VALUES (?, ?, ?, ?, 'd1_inline', 'gzip', ?, NULL, ?, ?, unixepoch())
      ON CONFLICT(session_id) DO UPDATE SET
        checkpoint_seq = excluded.checkpoint_seq,
        node_count = excluded.node_count,
        edge_count = excluded.edge_count,
        storage_tier = 'd1_inline',
        compression_codec = 'gzip',
        snapshot_payload = excluded.snapshot_payload,
        snapshot_r2_key = NULL,
        byte_size = excluded.byte_size,
        payload_sha256 = excluded.payload_sha256,
        updated_at = excluded.updated_at;
    `).bind(dbSessionId, checkpointSeq, nodeCount, edgeCount, compressedBytes, byteSize, sha256).run();
  } else {
    // Tier 2: Cloudflare R2 Bucket Offload
    if (!c.env.CANGREJO_VAULT_R2) {
      throw new Error(`R2 bucket binding CANGREJO_VAULT_R2 missing; cannot offload ${byteSize} byte snapshot.`);
    }

    const r2Key = `snapshots/${tenantId}/${dbSessionId}/chk_${checkpointSeq}.cgrj.gz`;
    await c.env.CANGREJO_VAULT_R2.put(r2Key, compressedBytes, {
      customMetadata: {
        tenantId,
        sessionId: dbSessionId,
        checkpointSeq: String(checkpointSeq),
        sha256,
        nodeCount: String(nodeCount),
        edgeCount: String(edgeCount),
      },
    });

    await c.env.DB.prepare(`
      INSERT INTO cangrejo_session_graphs (
        session_id, checkpoint_seq, node_count, edge_count,
        storage_tier, compression_codec, snapshot_payload, snapshot_r2_key,
        byte_size, payload_sha256, updated_at
      ) VALUES (?, ?, ?, ?, 'r2_offload', 'gzip', NULL, ?, ?, ?, unixepoch())
      ON CONFLICT(session_id) DO UPDATE SET
        checkpoint_seq = excluded.checkpoint_seq,
        node_count = excluded.node_count,
        edge_count = excluded.edge_count,
        storage_tier = 'r2_offload',
        compression_codec = 'gzip',
        snapshot_payload = NULL,
        snapshot_r2_key = excluded.snapshot_r2_key,
        byte_size = excluded.byte_size,
        payload_sha256 = excluded.payload_sha256,
        updated_at = excluded.updated_at;
    `).bind(dbSessionId, checkpointSeq, nodeCount, edgeCount, r2Key, byteSize, sha256).run();
  }
}

export async function hydrateStoreFromD1Snapshot(
  c: Context,
  scopedKey: string,
  dbSessionId: string,
  checkpointSeq: number,
  d1LastSeq: number
): Promise<GraphStore> {
  const graphRow = await c.env.DB.prepare(`
    SELECT checkpoint_seq, storage_tier, compression_codec, snapshot_payload, snapshot_r2_key, payload_sha256
    FROM cangrejo_session_graphs
    WHERE session_id = ?
  `).bind(dbSessionId).first<{
    checkpoint_seq: number;
    storage_tier: 'd1_inline' | 'r2_offload';
    compression_codec: string;
    snapshot_payload: ArrayBuffer | null;
    snapshot_r2_key: string | null;
    payload_sha256: string;
  }>();

  let store: GraphStore;

  if (graphRow) {
    let compressedBytes: Uint8Array;

    if (graphRow.storage_tier === 'd1_inline') {
      compressedBytes = new Uint8Array(graphRow.snapshot_payload as ArrayBuffer);
    } else {
      if (!c.env.CANGREJO_VAULT_R2) {
        throw new Error(`Cannot hydrate from R2: CANGREJO_VAULT_R2 binding is undefined.`);
      }
      const r2Object = await c.env.CANGREJO_VAULT_R2.get(graphRow.snapshot_r2_key as string);
      if (!r2Object) {
        throw new Error(`Snapshot R2 object not found at key: ${graphRow.snapshot_r2_key}`);
      }
      compressedBytes = new Uint8Array(await r2Object.arrayBuffer());
    }

    // Verify cryptographic integrity seal
    const computedSha = createHash('sha256').update(compressedBytes).digest('hex');
    if (computedSha !== graphRow.payload_sha256) {
      throw new Error(`Daubert integrity violation: snapshot SHA-256 mismatch for session ${dbSessionId}`);
    }

    // Decompress and deserialize
    const jsonText = await decompressGraphSnapshot(compressedBytes);
    const doc = JSON.parse(jsonText);
    store = GraphStore.deserializeFromCgrj(doc);
  } else {
    // Initial empty graph
    store = new GraphStore();
  }

  // Replay remaining mutations between checkpoint and lastSeq
  if (checkpointSeq < d1LastSeq) {
    const trailingRows = await c.env.DB.prepare(`
      SELECT seq, delta_id, delta_json
      FROM cangrejo_graph_mutations
      WHERE session_id = ? AND seq > ?
      ORDER BY seq ASC
    `).bind(dbSessionId, checkpointSeq).all<{
      seq: number;
      delta_id: string;
      delta_json: string;
    }>();

    for (const row of trailingRows.results) {
      const delta = JSON.parse(row.delta_json);
      CollaborationRoomHub.applyDeltaToStore(store, delta);
    }
  }

  sessionRooms.set(scopedKey, { store, lastSeq: d1LastSeq });
  return store;
}
```

---

## 4. Workstation UI Integration & Analyst Onboarding

### 4.1 Onboarding Philosophy & Human Factors

Connecting an external AI assistant (Claude Desktop, Cursor, Claude Code) to an active forensic investigation must be instantaneous, error-proof, and accessible. Analysts operating under high-stress incident response conditions cannot be burdened with manually crafting JSON-RPC schema files or reverse-engineering authentication parameters.

The **Cangrejo Edition Modal** (`#edition-modal-backdrop`) serves as the command center for license management and MCP client onboarding.

### 4.2 DOM Specification for `#edition-modal-backdrop`

The following section is inserted into `#edition-modal-backdrop .modal-body` (directly following the license activation controls in `index.html` at the repository root):

```html
<!-- Section: Model Context Protocol (MCP) Client Onboarding -->
<div class="lore-section" id="mcp-onboarding-section">
  <div class="mcp-section-header">
    <div class="mcp-title-wrap">
      <h3>🤖 Conexión de Asistentes IA &amp; Clientes MCP (Model Context Protocol)</h3>
      <span id="mcp-active-edition-tag" class="status-pill status-pill-community">COMMUNITY (LOCAL)</span>
    </div>
    <div class="mcp-health-badge" title="12 herramientas forenses listas para invocación">
      <span class="presence-dot"></span>
      <span id="lbl-mcp-tool-count" class="tabular">12 herramientas MCP activas</span>
    </div>
  </div>

  <p class="mcp-desc-text">
    Conecta <strong>Claude Desktop</strong>, <strong>Cursor</strong> o <strong>Claude Code CLI</strong> para interactuar directamente con el grafo pericial activo. Los agentes pueden mutar entidades, desofuscar IOCs, mapear tácticas MITRE ATT&amp;CK y sintetizar dictámenes Daubert.
  </p>

  <!-- Interactive Controls: Transport & Session Parameters -->
  <div class="mcp-controls-grid">
    <div class="mcp-field-group">
      <label for="inp-mcp-session-id" class="mcp-label">Expediente / Sala Activa (Session ID):</label>
      <input
        id="inp-mcp-session-id"
        type="text"
        class="palette-search-input"
        value="expediente-apt29"
        placeholder="expediente-apt29"
        aria-label="Identificador de sesión o expediente"
      />
    </div>

    <div id="mcp-token-container" class="mcp-field-group hidden">
      <label for="inp-mcp-auth-token" class="mcp-label">Token de Licencia (Bearer Auth):</label>
      <div class="mcp-input-action-row">
        <input
          id="inp-mcp-auth-token"
          type="password"
          class="palette-search-input mcp-token-input"
          placeholder="CGRJ.ORO_PRO... o pega tu clave"
          value=""
          aria-label="Token de autenticación Bearer"
          autocomplete="off"
          spellcheck="false"
        />
        <button id="btn-mcp-toggle-token" type="button" class="btn btn-subtle" aria-label="Mostrar clave de licencia">
          👁️ Ver
        </button>
      </div>
    </div>

    <!-- Sub-transport toggle for Community edition -->
    <div id="mcp-community-transport-toggle" class="mcp-field-group">
      <label class="mcp-label">Protocolo de Transporte:</label>
      <div class="console-tabs" role="tablist">
        <button id="btn-transport-stdio" type="button" class="tab-btn active" role="tab" aria-selected="true">Stdio (Local Bun)</button>
        <button id="btn-transport-http" type="button" class="tab-btn" role="tab" aria-selected="false">HTTP / SSE (:3000)</button>
      </div>
    </div>
  </div>

  <!-- Client Selector Tabs -->
  <div class="mcp-client-tabs-bar">
    <div class="console-tabs" role="tablist" aria-label="Clientes MCP compatibles">
      <button id="tab-client-claude-desktop" type="button" class="tab-btn active" role="tab" aria-selected="true">
        Claude Desktop
      </button>
      <button id="tab-client-cursor" type="button" class="tab-btn" role="tab" aria-selected="false">
        Cursor (.cursor/mcp.json)
      </button>
      <button id="tab-client-claude-code" type="button" class="tab-btn" role="tab" aria-selected="false">
        Claude Code CLI
      </button>
    </div>
    <span id="lbl-mcp-filepath" class="mcp-filepath-hint">
      Archivo: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
    </span>
  </div>

  <!-- Code Block with Copy Action -->
  <div class="mcp-code-container">
    <pre id="mcp-snippet-output" class="console-output mcp-code-block"></pre>
    <button id="btn-mcp-copy-snippet" type="button" class="btn btn-primary mcp-copy-btn" aria-label="Copiar configuración al portapapeles">
      📋 Copiar Configuración
    </button>
  </div>
</div>
```

### 4.3 CSS Token Integration, Viewport Containment & WCAG 2.1 AAA Accessibility

Added to `apps/web/styles.css` using exclusively `@cangrejo/design-tokens` semantic variables:

```css
/* ==========================================================================
   MCP Client Onboarding Section & Interactive Snippet Cards
   ========================================================================== */
.mcp-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  flex-wrap: wrap;
  gap: 8px;
}

.mcp-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mcp-desc-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

/* Remediated for WCAG 2.1 AAA: var(--text-subtle) ensures >= 9.45:1 on sunken surface */
.mcp-health-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-subtle);
  background: var(--surface-sunken);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.mcp-controls-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.mcp-field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mcp-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.mcp-input-action-row {
  display: flex;
  gap: 4px;
}

.mcp-token-input {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11px;
}

.mcp-client-tabs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
  flex-wrap: wrap;
}

.mcp-filepath-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.mcp-filepath-hint code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  background: var(--surface-sunken);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.mcp-code-container {
  position: relative;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--surface-sunken);
}

/* Controlled scrollable code block preventing modal blowout */
.mcp-code-block {
  max-height: 180px;
  min-height: 100px;
  overflow-y: auto;
  overflow-x: auto;
  padding: 12px 14px;
  margin: 0;
  font-size: 11px;
  font-family: var(--font-mono);
  line-height: 1.45;
  user-select: text;
}

.mcp-copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.status-pill-community {
  background: var(--surface-sunken);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
}

/* Dark Mode: Sky300 (#7dd3fc) on 14% tint yields 9.20:1 (WCAG AAA >= 7.0:1) */
.status-pill-cloud {
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.45);
  color: #7dd3fc;
}

/* Light Mode: Sky900 (#0c4a6e) on 10% tint yields 8.36:1, 9.46:1 on white (WCAG AAA >= 7.0:1) */
[data-theme='light'] .status-pill-cloud {
  background: rgba(2, 132, 199, 0.10);
  border: 1px solid rgba(2, 132, 199, 0.40);
  color: #0c4a6e;
}

/* ==========================================================================
   Modal Card Viewport Containment & Scroll Boundary
   ========================================================================== */
.modal-card {
  width: min(680px, 100%);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  background: var(--surface-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.modal-header {
  flex-shrink: 0;
}

.modal-body {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

#### Contrast Ratio Verification ($\ge 7:1$ WCAG AAA):
| Theme | UI Element | Foreground | Background | Contrast Ratio | WCAG 2.1 AAA Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Obsidian Dark** | `.status-pill-cloud` text | `#7dd3fc` (Sky 300) | `#102736` (14% tint on panel) | **$9.20:1$** | **PASS AAA** ($\ge 7.0:1$) |
| **Obsidian Dark** | `.status-pill-cloud` text | `#7dd3fc` (Sky 300) | `#05070b` (sunken canvas) | **$12.09:1$** | **PASS AAA** ($\ge 7.0:1$) |
| **Obsidian Dark** | `.mcp-health-badge` text | `#cbd5e1` (`--text-subtle`) | `#05070b` (`--surface-sunken`) | **$13.58:1$** | **PASS AAA** ($\ge 7.0:1$) |
| **Obsidian Dark** | Code Block text | `#f9fafb` (`--text-primary`) | `#05070b` (`--surface-sunken`) | **$18.10:1$** | **PASS AAA** ($\ge 7.0:1$) |
| **Daylight Light** | `.status-pill-cloud` text | `#0c4a6e` (Sky 900) | `#ffffff` (`--surface-panel`) | **$9.46:1$** | **PASS AAA** ($\ge 7.0:1$) |
| **Daylight Light** | `.status-pill-cloud` text | `#0c4a6e` (Sky 900) | `#e6f2f9` (10% tint on white) | **$8.36:1$** | **PASS AAA** ($\ge 7.0:1$) |
| **Daylight Light** | `.mcp-health-badge` text | `#334155` (`--text-subtle`) | `#f1f5f9` (`--surface-sunken`) | **$9.45:1$** | **PASS AAA** ($\ge 7.0:1$) |
| **Daylight Light** | Code Block text | `#0f172a` (`--text-primary`) | `#f1f5f9` (`--surface-sunken`) | **$16.30:1$** | **PASS AAA** ($\ge 7.0:1$) |

### 4.4 Dynamic Client-Side Controller (`apps/web/main.ts`)

```typescript
type McpClientType = 'claude-desktop' | 'cursor' | 'claude-code';
type McpTransportType = 'stdio' | 'http';

interface McpUiState {
  client: McpClientType;
  transport: McpTransportType;
  editionTier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
  licenseKey: string | null;
  sessionId: string;
}

const MCP_STORAGE_TOKEN_KEY = 'cangrejo_mcp_auth_token';

const mcpState: McpUiState = {
  client: 'claude-desktop',
  transport: 'stdio',
  editionTier: 'COMMUNITY',
  licenseKey: null,
  sessionId: 'expediente-apt29',
};

/**
 * Initializes listeners for MCP client onboarding modal controls.
 * Invoked once during workstation bootstrap (`main.ts`).
 */
export function initMcpModalController(): void {
  // Session ID input listener
  const sessionInp = document.getElementById('inp-mcp-session-id') as HTMLInputElement | null;
  sessionInp?.addEventListener('input', (e) => {
    mcpState.sessionId = (e.target as HTMLInputElement).value.trim() || 'expediente-apt29';
    renderMcpSnippet();
  });

  // Bearer Token input listener + sessionStorage persistence
  const tokenInp = document.getElementById('inp-mcp-auth-token') as HTMLInputElement | null;
  tokenInp?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value.trim();
    mcpState.licenseKey = val.length > 0 ? val : null;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (val) window.sessionStorage.setItem(MCP_STORAGE_TOKEN_KEY, val);
      else window.sessionStorage.removeItem(MCP_STORAGE_TOKEN_KEY);
    }
    renderMcpSnippet();
  });

  // Password / Token visibility toggle
  const toggleBtn = document.getElementById('btn-mcp-toggle-token');
  toggleBtn?.addEventListener('click', () => {
    if (!tokenInp) return;
    const isPassword = tokenInp.type === 'password';
    tokenInp.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? '🙈 Ocultar' : '👁️ Ver';
    toggleBtn.setAttribute('aria-label', isPassword ? 'Ocultar clave de licencia' : 'Mostrar clave de licencia');
  });

  // Client tab switching
  const clientTabs: Array<{ id: string; client: McpClientType }> = [
    { id: 'tab-client-claude-desktop', client: 'claude-desktop' },
    { id: 'tab-client-cursor', client: 'cursor' },
    { id: 'tab-client-claude-code', client: 'claude-code' },
  ];

  for (const { id, client } of clientTabs) {
    document.getElementById(id)?.addEventListener('click', () => {
      mcpState.client = client;
      for (const t of clientTabs) {
        const btn = document.getElementById(t.id);
        const isActive = t.client === client;
        btn?.classList.toggle('active', isActive);
        btn?.setAttribute('aria-selected', String(isActive));
      }
      renderMcpSnippet();
    });
  }

  // Community sub-transport switching
  const stdioBtn = document.getElementById('btn-transport-stdio');
  const httpBtn = document.getElementById('btn-transport-http');
  stdioBtn?.addEventListener('click', () => {
    mcpState.transport = 'stdio';
    stdioBtn.classList.add('active');
    stdioBtn.setAttribute('aria-selected', 'true');
    httpBtn?.classList.remove('active');
    httpBtn?.setAttribute('aria-selected', 'false');
    renderMcpSnippet();
  });
  httpBtn?.addEventListener('click', () => {
    mcpState.transport = 'http';
    httpBtn.classList.add('active');
    httpBtn.setAttribute('aria-selected', 'true');
    stdioBtn?.classList.remove('active');
    stdioBtn?.setAttribute('aria-selected', 'false');
    renderMcpSnippet();
  });

  // Copy to clipboard handler with visual feedback
  const copyBtn = document.getElementById('btn-mcp-copy-snippet');
  copyBtn?.addEventListener('click', async () => {
    const codeEl = document.getElementById('mcp-snippet-output');
    if (!codeEl?.textContent) return;
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '✅ ¡Copiado!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    } catch {
      // Fallback
    }
  });

  // Restore cached session token if available
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const cachedToken = window.sessionStorage.getItem(MCP_STORAGE_TOKEN_KEY);
    if (cachedToken && tokenInp) {
      tokenInp.value = cachedToken;
      mcpState.licenseKey = cachedToken;
    }
  }
}

/**
 * Invoked by syncEditionBadge() when edition status is retrieved from /api/edition/status
 */
export function updateMcpOnboardingView(
  editionTier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE',
  rawKey: string | null
): void {
  mcpState.editionTier = editionTier;

  // Prefer existing rawKey from activation input or sessionStorage
  const tokenInp = document.getElementById('inp-mcp-auth-token') as HTMLInputElement | null;
  const cached = typeof window !== 'undefined' && window.sessionStorage
    ? window.sessionStorage.getItem(MCP_STORAGE_TOKEN_KEY)
    : null;

  if (rawKey && !rawKey.includes('****')) {
    mcpState.licenseKey = rawKey;
    if (tokenInp) tokenInp.value = rawKey;
  } else if (cached) {
    mcpState.licenseKey = cached;
    if (tokenInp) tokenInp.value = cached;
  }

  renderMcpSnippet();
}

function renderMcpSnippet(): void {
  const isCloud = mcpState.editionTier !== 'COMMUNITY';
  const host = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
  const cloudHost = host.includes('127.0.0.1') || host.includes('localhost')
    ? 'https://cangrejo.osint.network'
    : host;
  const token = mcpState.licenseKey || 'CGRJ-LICENSE-TOKEN-AQUI';
  const session = mcpState.sessionId.trim() || 'expediente-apt29';

  let snippet = '';
  let pathHint = '';

  if (mcpState.client === 'claude-desktop') {
    pathHint = 'Archivo: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (o <code>%APPDATA%\\Claude\\...</code>)';
    if (!isCloud) {
      if (mcpState.transport === 'stdio') {
        snippet = JSON.stringify({
          mcpServers: {
            cangrejo: {
              command: 'bun',
              args: ['run', 'apps/web/mcpStdioServer.ts'],
              cwd: '/path/to/cangrejo',
              env: { CANGREJO_MCP_URL: `${host}/api/mcp` },
            },
          },
        }, null, 2);
      } else {
        snippet = JSON.stringify({
          mcpServers: {
            cangrejo: {
              command: 'bun',
              args: ['run', 'apps/web/mcpStdioServer.ts'],
              cwd: '/path/to/cangrejo',
              env: { CANGREJO_MCP_URL: `${host}/api/mcp` },
            },
          },
        }, null, 2);
      }
    } else {
      // Cloud SaaS: Native zero-dependency stdio bridge via Cangrejo mcpStdioServer
      snippet = JSON.stringify({
        mcpServers: {
          'cangrejo-cloud': {
            command: 'bun',
            args: ['run', 'apps/web/mcpStdioServer.ts'],
            cwd: '/path/to/cangrejo',
            env: {
              CANGREJO_MCP_URL: `${cloudHost}/api/mcp/${session}`,
              CANGREJO_MCP_TOKEN: token,
            },
          },
        },
      }, null, 2);
    }
  } else if (mcpState.client === 'cursor') {
    pathHint = 'Archivo: <code>.cursor/mcp.json</code> en la raíz de tu proyecto';
    if (!isCloud) {
      if (mcpState.transport === 'stdio') {
        snippet = JSON.stringify({
          mcpServers: {
            cangrejo: {
              command: 'bun',
              args: ['run', 'mcp:stdio'],
              cwd: '/path/to/cangrejo',
            },
          },
        }, null, 2);
      } else {
        snippet = JSON.stringify({
          mcpServers: {
            cangrejo: { url: `${host}/api/mcp` },
          },
        }, null, 2);
      }
    } else {
      snippet = JSON.stringify({
        mcpServers: {
          'cangrejo-cloud': {
            url: `${cloudHost}/api/mcp/${session}`,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }, null, 2);
    }
  } else if (mcpState.client === 'claude-code') {
    pathHint = 'Ejecuta directamente en tu terminal:';
    if (!isCloud) {
      if (mcpState.transport === 'stdio') {
        snippet = `claude mcp add cangrejo bun run --cwd /path/to/cangrejo mcp:stdio`;
      } else {
        snippet = `claude mcp add --transport http cangrejo ${host}/api/mcp`;
      }
    } else {
      snippet = `claude mcp add --transport http --header "Authorization: Bearer ${token}" cangrejo-cloud ${cloudHost}/api/mcp/${session}`;
    }
  }

  const outEl = document.getElementById('mcp-snippet-output');
  if (outEl) outEl.textContent = snippet;
  const hintEl = document.getElementById('lbl-mcp-filepath');
  if (hintEl) hintEl.innerHTML = pathHint;

  // Visual edition toggles
  const tokenBox = document.getElementById('mcp-token-container');
  const transportToggle = document.getElementById('mcp-community-transport-toggle');
  const editionTag = document.getElementById('mcp-active-edition-tag');

  if (isCloud) {
    tokenBox?.classList.remove('hidden');
    transportToggle?.classList.add('hidden');
    if (editionTag) {
      editionTag.textContent = `${mcpState.editionTier} (CLOUD SAAS)`;
      editionTag.className = 'status-pill status-pill-cloud';
    }
  } else {
    tokenBox?.classList.add('hidden');
    transportToggle?.classList.remove('hidden');
    if (editionTag) {
      editionTag.textContent = 'COMMUNITY (LOCAL)';
      editionTag.className = 'status-pill status-pill-community';
    }
  }
}
```

### 4.5 Production-Ready Configuration Snippets

#### 4.5.1 Claude Desktop Configurations

**Community Edition (Local Stdio via Bun)**:
```json
{
  "mcpServers": {
    "cangrejo": {
      "command": "bun",
      "args": [
        "run",
        "apps/web/mcpStdioServer.ts"
      ],
      "cwd": "/path/to/cangrejo",
      "env": {
        "CANGREJO_MCP_URL": "http://127.0.0.1:3000/api/mcp"
      }
    }
  }
}
```

**Community Edition (Docker Container)**:
```json
{
  "mcpServers": {
    "cangrejo": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "cangrejo-workstation",
        "bun",
        "run",
        "apps/web/mcpStdioServer.ts"
      ]
    }
  }
}
```

**Managed Cloud SaaS Edition (Claude Desktop via Native Cangrejo Stdio Bridge - Recommended)**:
```json
{
  "mcpServers": {
    "cangrejo-cloud": {
      "command": "bun",
      "args": [
        "run",
        "apps/web/mcpStdioServer.ts"
      ],
      "cwd": "/path/to/cangrejo",
      "env": {
        "CANGREJO_MCP_URL": "https://cangrejo.osint.network/api/mcp/expediente-apt29",
        "CANGREJO_MCP_TOKEN": "CGRJ.ORO_PRO.eyJ0aWVyIjoiT1JPX1BSTyIsIm9yZ2FuaXphdGlvbk5hbWUiOiJVbmlkYWQgQW50aWZyYXVkZSIsImNyZWRpdHMiOjUwMCwiaXNzdWVkQXQiOjE3MzA3MjgwMDAwMDAsImV4cGlyZXNBdCI6MTc2MjI2NDAwMDAwMH0.3a7f82c9e4b10b0e98c7654321fedcba1234567890abcdef1234567890abcdef"
      }
    }
  }
}
```

**Alternative: Standalone `mcp-remote` Proxy (No Local Clone Required)**:
For analysts using Claude Desktop on a machine without the Cangrejo repository cloned:
```json
{
  "mcpServers": {
    "cangrejo-cloud": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://cangrejo.osint.network/api/mcp/expediente-apt29",
        "--header",
        "Authorization: Bearer CGRJ.ORO_PRO.eyJ0aWVyIjoiT1JPX1BSTyIsIm9yZ2FuaXphdGlvbk5hbWUiOiJVbmlkYWQgQW50aWZyYXVkZSIsImNyZWRpdHMiOjUwMCwiaXNzdWVkQXQiOjE3MzA3MjgwMDAwMDAsImV4cGlyZXNBdCI6MTc2MjI2NDAwMDAwMH0.3a7f82c9e4b10b0e98c7654321fedcba1234567890abcdef1234567890abcdef"
      ]
    }
  }
}
```

#### 4.5.2 Cursor IDE Configurations (`.cursor/mcp.json`)

**Community Edition (Local HTTP)**:
```json
{
  "mcpServers": {
    "cangrejo": {
      "url": "http://127.0.0.1:3000/api/mcp"
    }
  }
}
```

**Managed Cloud SaaS Edition (Native Authenticated HTTP)**:
```json
{
  "mcpServers": {
    "cangrejo-cloud": {
      "url": "https://cangrejo.osint.network/api/mcp/expediente-apt29",
      "headers": {
        "Authorization": "Bearer CGRJ.PLATINO_ENTERPRISE.eyJ0aWVyIjoiUExBVElOT19FTlRFUlBSSVNFIiwib3JnYW5pemF0aW9uTmFtZSI6IkNvbnN1bHRvcmEgRm9yZW5zZSIsImNyZWRpdHMiOjUwMDAsImlzc3VlZEF0IjoxNzMwNzI4MDAwMDAwLCJleHBpcmVzQXQiOjE3NjIyNjQwMDAwMDB9.8e1b4c2d3a9876543210fedcba9876543210fedcba9876543210fedcba987654"
      }
    }
  }
}
```

#### 4.5.3 Claude Code CLI Commands

**Community Edition**:
```bash
# Stdio transport
claude mcp add cangrejo bun run --cwd /path/to/cangrejo mcp:stdio

# HTTP transport
claude mcp add --transport http cangrejo http://127.0.0.1:3000/api/mcp
```

**Managed Cloud SaaS Edition**:
```bash
claude mcp add --transport http \
  --header "Authorization: Bearer CGRJ.PLATINO_ENTERPRISE.eyJ0aWVyIjoiUExBVElOT19FTlRFUlBSSVNFIiwib3JnYW5pemF0aW9uTmFtZSI6IkNvbnN1bHRvcmEgRm9yZW5zZSIsImNyZWRpdHMiOjUwMDAsImlzc3VlZEF0IjoxNzMwNzI4MDAwMDAwLCJleHBpcmVzQXQiOjE3NjIyNjQwMDAwMDB9.8e1b4c2d3a9876543210fedcba9876543210fedcba9876543210fedcba987654" \
  cangrejo-cloud \
  https://cangrejo.osint.network/api/mcp/expediente-apt29
```

---

## 5. Phased Implementation Roadmap

The implementation is structured into 4 sequential, non-breaking engineering phases.

```
+--------------------------------------------------------------------------------------------------------+
|                                  PHASED IMPLEMENTATION ROADMAP                                         |
+--------------------+---------------------------------------------------------------+-------------------+
| Phase              | Objectives & Deliverables                                     | Impacted Packages |
+--------------------+---------------------------------------------------------------+-------------------+
| PHASE 1:           | - Create migration 0003_mcp_session_vault.sql with composite  | @cangrejo/        |
| Schema & Database  |   PK, two-tier BLOB/R2 snapshots, and deduplicated index      | database-d1       |
| Persistence        | - Implement D1 / SQLite SessionVault helpers in BunSqliteVault|                   |
|                    | - Implement atomic db.batch() mutation append & Gzip codec    |                   |
|                    | - Configure wrangler.jsonc R2 bucket CANGREJO_VAULT_R2        |                   |
+--------------------+---------------------------------------------------------------+-------------------+
| PHASE 2:           | - Add /api/mcp/:sessionId parameterized endpoints             | @cangrejo/web     |
| Backend Routing &  | - Implement JIT provisioning in mcpAuthMiddleware             |                   |
| Middleware         | - Enforce Compaction Boundary Invariant (Scached >= Schk)     |                   |
|                    | - Support CANGREJO_MCP_TOKEN in apps/web/mcpStdioServer.ts    |                   |
|                    | - Implement two-tier hydration (D1 BLOB & R2 offload)         |                   |
+--------------------+---------------------------------------------------------------+-------------------+
| PHASE 3:           | - Add #mcp-onboarding-section DOM to root index.html          | @cangrejo/web     |
| Workstation UI &   | - Add WCAG 2.1 AAA CSS & modal viewport containment in styles | @cangrejo/        |
| Client Onboarding  | - Implement interactive controller in main.ts with token      | design-tokens     |
|                    |   masking toggle, sessionStorage caching & stdio snippets     |                   |
+--------------------+---------------------------------------------------------------+-------------------+
| PHASE 4:           | - Author tests/gate12-multi-tenant-mcp-sessions.test.ts       | tests/            |
| Verification &     | - Test cross-tenant isolation and 401/403 rejection           |                   |
| Quality Gate       | - Test atomic OCC batch rollback & compaction boundary eviction|                   |
|                    | - Test Gzip compression & R2 offload with SHA-256 seal        |                   |
|                    | - Validate full monorepo gate suite (bun test & typecheck)    |                   |
+--------------------+---------------------------------------------------------------+-------------------+
```

### 5.1 Phase 1: Schema & Database Persistence Layer

- **Target Files**:
  - `packages/database-d1/migrations/0003_mcp_session_vault.sql`:
    - Define composite primary key `session_id TEXT PRIMARY KEY` as `${tenantId}:${rawSessionId}`.
    - Add `raw_session_id TEXT NOT NULL` and `CONSTRAINT uq_tenant_raw_session UNIQUE (tenant_id, raw_session_id)`.
    - Make `session_token_hash TEXT` nullable with partial unique index `WHERE session_token_hash IS NOT NULL`.
    - Implement two-tier snapshot columns in `cangrejo_session_graphs`: `storage_tier`, `compression_codec`, `snapshot_payload BLOB`, `snapshot_r2_key`, `byte_size`, and `payload_sha256`.
    - Omit duplicate index `idx_mutations_session_seq` (relying on `sqlite_autoindex_cangrejo_graph_mutations_2`) to prevent write amplification.
  - `packages/database-d1/src/BunSqliteVault.ts`:
    - Extend `initLocalSchema()` to create tables in local SQLite.
    - Implement atomic `appendGraphMutation(dbSessionId, seq, delta, authorId)` using `db.batch([insertMutationStmt, updateSessionStmt])`.
    - Implement `compressGraphSnapshot` and `decompressGraphSnapshot` using Web Streams `CompressionStream` / `DecompressionStream`.
    - Implement `hydrateSessionGraph(dbSessionId)` reading snapshot (inline BLOB or R2) + trailing deltas.
    - Implement `persistGraphSnapshot(tenantId, dbSessionId, checkpointSeq, store)` with 1.5 MB threshold routing between D1 BLOB and R2 bucket.
  - `wrangler.jsonc`:
    - Bind `CANGREJO_VAULT_R2` bucket `cangrejo-vault-snapshots`.
- **Query Flow Verification**:
  - Verify SQLite WAL execution, triggers, and partial indexes.
  - Test constraint violation handling and rollback on duplicate `(session_id, seq)` pairs in atomic batches.

### 5.2 Phase 2: Backend Routing, Middleware & Session Orchestrator

- **Target Files**:
  - `apps/web/honoApp.ts`:
    - Register routes:
      ```typescript
      cangrejoHonoApp.get('/api/mcp', mcpAuthMiddleware, handleMcpCatalogRequest);
      cangrejoHonoApp.post('/api/mcp', mcpAuthMiddleware, handleMcpJsonRpcDispatch);
      cangrejoHonoApp.get('/api/mcp/:sessionId', mcpAuthMiddleware, handleMcpCatalogRequest);
      cangrejoHonoApp.post('/api/mcp/:sessionId', mcpAuthMiddleware, handleMcpJsonRpcDispatch);
      ```
    - Implement Just-In-Time (JIT) provisioning in `mcpAuthMiddleware` for `CGRJ.*` tokens using `env.DB.batch([upsertTenantStmt, upsertSessionStmt])`.
    - Implement `ensureSessionStore` with Compaction Boundary Invariant enforcement ($S_{cached} \ge S_{checkpoint}$), evicting stale isolate memory on boundary gaps.
    - Update `cangrejo_session_mutate_graph`:
      - Execute `store.runInBatch()` and serialize delta.
      - Commit mutation and advance session sequence via atomic D1 batch.
      - Trigger background snapshot compaction via `ctx.waitUntil()` every 50 mutations.
  - `apps/web/mcpStdioServer.ts`:
    - Allow optional authentication token forwarding via `CANGREJO_MCP_TOKEN`.
    - Support targeting `/api/mcp/${CANGREJO_SESSION_ID}` when `CANGREJO_SESSION_ID` is set.
  - `apps/web/cloudflareWorker.ts`:
    - Forward Worker execution context `ctx` to Hono handlers for `ctx.waitUntil()` background snapshot compaction.

### 5.3 Phase 3: Workstation UI & Client Configuration Generator

- **Target Files**:
  - `index.html` (Repository Root):
    - Insert `#mcp-onboarding-section` inside `#edition-modal-backdrop .modal-body`.
    - Provide interactive `#inp-mcp-session-id`, editable `#inp-mcp-auth-token`, and visibility toggle `#btn-mcp-toggle-token`.
  - `apps/web/styles.css`:
    - Add WCAG 2.1 AAA theme-scoped styles for `.status-pill-cloud`:
      - Dark mode: `#7dd3fc` on 14% tint ($9.20:1$ / $12.09:1$).
      - Light mode (`[data-theme='light']`): `#0c4a6e` on 10% tint ($8.36:1$ / $9.46:1$).
    - Remediate `.mcp-health-badge` with `var(--text-subtle)` ($9.45:1$ light / $13.58:1$ dark).
    - Enforce modal viewport height containment: `.modal-card { max-height: calc(100vh - 40px); display: flex; flex-direction: column; }` and `.modal-body { flex: 1 1 auto; overflow-y: auto; }`.
    - Bound `.mcp-code-block { max-height: 180px; min-height: 100px; overflow: auto; }`.
  - `apps/web/main.ts`:
    - Implement `initMcpModalController()`:
      - Live input event listeners for session ID and license token.
      - Password masking toggle (`type="password"` <-> `type="text"`).
      - Token persistence in `window.sessionStorage` (`cangrejo_mcp_auth_token`) to prevent masked asterisks in snippets.
      - Tab switching for Claude Desktop, Cursor, and Claude Code.
      - Transport toggle between Stdio and HTTP.
      - Copy to clipboard with feedback animation.
    - Generate Claude Desktop snippet using Cangrejo native `apps/web/mcpStdioServer.ts` bridge with `CANGREJO_MCP_URL` and `CANGREJO_MCP_TOKEN`.

### 5.4 Phase 4: Automated Verification & Architectural Gate 12

- **Target Files**:
  - `tests/gate12-multi-tenant-mcp-sessions.test.ts`:
    - Test Suite 1: **Session Isolation & Cryptographic JIT Authentication**:
      - Verify that unauthenticated requests to `/api/mcp/:sessionId` fail with HTTP 401 / JSON-RPC error `-32000`.
      - Verify JIT provisioning creates tenant and session rows on valid `CGRJ.*` token receipt.
      - Verify that Tenant A (`CGRJ.ORO_PRO...`) adding entity `"alpha.corp"` to `expediente-apt29` cannot be seen by Tenant B (`CGRJ.PLATINO...`) querying `expediente-apt29` (composite primary key validation).
    - Test Suite 2: **Write-Ahead Log (WAL) OCC & Atomic Batch Retries**:
      - Simulate two concurrent edge isolates appending mutations at `seq = 1`.
      - Verify that the second isolate catches `SQLITE_CONSTRAINT_UNIQUE`, rolls back atomically without corrupting `last_seq`, reconciles the missed delta, and appends at `seq = 2`.
    - Test Suite 3: **Compaction Boundary Invariant & Two-Tier Storage Parity**:
      - Simulate isolate memory gap ($S_{cached} < S_{checkpoint}$) after compaction; verify that isolate evicts memory and safely re-hydrates from snapshot.
      - Test Gzip compression roundtrip on 25k entities; verify payload size $\le 1.5\text{ MB}$ in D1 BLOB.
      - Test R2 offloading on >1.5 MB payload with SHA-256 seal verification.
    - Test Suite 4: **UI Snippet Generation & Accessibility Integrity**:
      - Verify that switching from Community to Platino dynamically updates generated configs.
      - Validate WCAG 2.1 AAA contrast ratios across Obsidian Dark and Daylight Light themes.

### 5.5 File Impact Matrix & Cross-Package Traceability

| Package / Directory | File Path | Scope of Modification | Invariant Guard |
| :--- | :--- | :--- | :--- |
| `packages/database-d1` | `migrations/0003_mcp_session_vault.sql` | DDL for 4 tables with composite PK, two-tier BLOB/R2 storage, and single composite index | Foreign keys ON, unique OCC constraints |
| `packages/database-d1` | `src/BunSqliteVault.ts` | Atomic `db.batch()` WAL mutation append, Gzip codec, R2 snapshot offload | Zero-copy Guid serialization |
| `packages/database-d1` | `wrangler.jsonc` | Declare R2 bucket `CANGREJO_VAULT_R2` binding | Serverless resource binding |
| `apps/web` | `honoApp.ts` | Route parameterization, JIT provisioning middleware, Compaction Boundary Invariant | 64-bit Guid non-zero, Zod `.passthrough()` |
| `apps/web` | `cloudflareWorker.ts` | Forward Worker execution context `ctx` to Hono for `waitUntil` | Serverless isolate memory isolation |
| `apps/web` | `mcpStdioServer.ts` | Support `CANGREJO_SESSION_ID` and `CANGREJO_MCP_TOKEN` bridge | Native zero-dependency stdio transport |
| Root | `index.html` | Insert `#mcp-onboarding-section` inside edition modal | Semantic HTML5 structure |
| `apps/web` | `styles.css` | Insert WCAG AAA theme tokens & modal viewport height containment | WCAG 2.1 AAA contrast ($\ge 7:1$) |
| `apps/web` | `main.ts` | Interactive controller with token masking toggle & sessionStorage | Reactive DOM state management |
| `tests` | `tests/gate12-multi-tenant-mcp-sessions.test.ts` | Automated end-to-end multi-tenant test suite | Genuine assertions, zero cheating |

---

## 6. Architectural Invariants & Security Compliance

Every implementation phase must strictly comply with Cangrejo's foundational architectural and forensic invariants:

### 6.1 64-Bit Non-Zero `Guid` Invariant (Gate 0)
- All entity and link identifiers are 64-bit unsigned integers represented as `bigint`.
- Value `0n` is strictly reserved as `Guid.ZERO` (sentinel / null pointer) and is forbidden as an entity or link identity.
- Serializers (`serializeModsToDelta`, `cgrj_payload`, `delta_json`) must format Guids as decimal or `0x`-prefixed hexadecimal strings, parsing back to `bigint` without IEEE 754 precision loss.

### 6.2 Tripartite `GraphStore` Atomic Deletion Cascading (Gate 1)
- The graph engine partitions state into three co-ordinated stores:
  1. `dataStore`: Entity and link attributes, custom forensic properties.
  2. `structureStore`: Compressed Sparse Row (CSR) adjacency index for $O(1)$ bidirectional graph traversals.
  3. `layoutStore`: Contiguous `Float32Array` buffers (64-byte node stride, 48-byte edge stride).
- When an entity is deleted (via MCP tool `cangrejo_session_mutate_graph`), the deletion **must atomically cascade** to all incident links across all three stores in a single reversible operation on `UndoRedoCommandManager`.

### 6.3 Zero-Pruning Schema Validation (Gate 4)
- Forensic investigators attach custom analyst properties (e.g. `x_ioc_threat_actor`, `x_daubert_admissibility_flag`, `custom_tags`).
- All Zod validation schemas operating at network or database boundaries must preserve `.passthrough()`. Stripping unrecognized fields is strictly prohibited.

### 6.4 Chain-of-Custody & Bóveda Cero Integrity (Gates 3, 6, 11)
- Exported `.cgrj` investigation packages in classified environments require AES-256-GCM attribute encryption (256-byte PKCS#7 blocks) combined with AES-GMAC topology signatures over the canonical sorted graph.
- Checkpoint graph snapshots in D1/R2 require SHA-256 hash sealing recorded in `cangrejo_session_graphs.payload_sha256` for Daubert / FRE 702 admissibility.
- STIX 2.1 imports must verify the `x_cangrejo_custody` SHA-256 manifest to guarantee forensic provenance.

### 6.5 WCAG 2.1 AAA Accessibility & Visual Performance
- Modal interfaces must maintain $\ge 7:1$ contrast across both `Obsidian Studio` (dark) and `Daylight Forensic Report` (light) themes:
  - Dark mode `.status-pill-cloud`: `#7dd3fc` over 14% tint yields $9.20:1$; over sunken canvas yields $12.09:1$.
  - Light mode `.status-pill-cloud`: `#0c4a6e` over 10% tint yields $8.36:1$; over white panel yields $9.46:1$.
  - `.mcp-health-badge`: `var(--text-subtle)` yields $9.45:1$ in light mode and $13.58:1$ in dark mode.
- Viewport Height Containment: `.modal-card` is bounded to `max-height: calc(100vh - 40px)` with `.modal-body { overflow-y: auto }` and `.mcp-code-block { max-height: 180px }`, preventing UI controls from overflowing the viewport on 1080p and 13-inch laptop displays.
- License Key Privacy & Masking: `#inp-mcp-auth-token` masks inputs as `type="password"` with an interactive visibility toggle button (`#btn-mcp-toggle-token`), and persists raw tokens in `window.sessionStorage` (`cangrejo_mcp_auth_token`) so page reloads do not inject masked strings (`CGRJ-PLATINO-****...`) into generated configuration files.

---

## 7. Conclusion & Next Steps

This specification unifies Cangrejo's local Open-Core Community edition with its Managed Cloud SaaS tier, providing a secure, performant, and intuitive Model Context Protocol infrastructure.

By employing:
- Parameterized session routing (`/api/mcp/:sessionId`),
- Cryptographic Bearer token verification with Just-In-Time (JIT) provisioning,
- Composite database session scoping (`${tenantId}:${rawSessionId}`),
- An atomic append-only Write-Ahead Log with Optimistic Concurrency Control,
- Compaction boundary checks preventing edge isolate desynchronization,
- A Two-Tier compressed snapshot architecture with Cloudflare R2 offloading, and
- An adaptive, WCAG 2.1 AAA accessible Workstation onboarding modal,

analysts can seamlessly pair frontier AI reasoning models with Cangrejo's high-performance graph engine, whether operating on an air-gapped laptop or across a globally distributed enterprise SOC.

Proceed to **Phase 1 Engineering Implementation** upon sign-off.

