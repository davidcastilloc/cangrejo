import { describe, expect, it } from 'vitest';
import { cangrejoHonoApp } from '../apps/web/honoApp.js';
import { BunSqliteVault } from '../packages/database-d1/src/index.js';

describe('Gate 13 — Native D1 Accounts, Users & Client Organizations (Multi-Tenant Auth)', () => {
  it('13.1 allows Community Local Bypass on GET /api/auth/me when unauthenticated', async () => {
    const res = await cangrejoHonoApp.request('http://127.0.0.1:3000/api/auth/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      authenticated: boolean;
      mode: string;
      user: unknown;
      client: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.authenticated).toBe(false);
    expect(body.mode).toBe('COMMUNITY_LOCAL_BYPASS');
    expect(body.user).toBeNull();
    expect(body.client).toBeNull();
  });

  it('13.2 registers Users + isolated Client Organizations with PBKDF2-SHA256 and rejects duplicate emails (409)', async () => {
    const testVault = new BunSqliteVault(':memory:');
    const d1 = testVault.asD1Database();

    const regRes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Comisario.Alpha@UnidadForense.org',
          password: 'ClaveForense#2026!Segura',
          displayName: 'Comisario Alpha',
          organizationName: 'División Forense Alpha',
          requestedTier: 'PLATINO_ENTERPRISE',
          customAnalystBadge: 'CTP-01', // zero-pruning passthrough check
        }),
      },
      { DB: d1 }
    );
    expect(regRes.status).toBe(201);
    const regJson = (await regRes.json()) as {
      ok: boolean;
      authenticated: boolean;
      authToken: string;
      licenseToken: string;
      user: { userId: string; tenantId: string; email: string; role: string };
      client: { tenantId: string; organizationName: string; tier: string; creditsRemaining: number };
      mcpSessions: Array<{ rawSessionId: string }>;
    };
    expect(regJson.ok).toBe(true);
    expect(regJson.authenticated).toBe(true);
    expect(regJson.authToken.startsWith('cgrj_usr_')).toBe(true);
    expect(regJson.licenseToken.startsWith('CGRJ.PLATINO_ENTERPRISE.')).toBe(true);
    expect(regJson.user.email).toBe('comisario.alpha@unidadforense.org');
    expect(regJson.user.tenantId).toBe(regJson.client.tenantId);
    expect(regJson.client.tenantId.startsWith('org_')).toBe(true);
    expect(regJson.client.creditsRemaining).toBe(5000);
    expect(regJson.mcpSessions.some((s) => s.rawSessionId === 'expediente-apt29')).toBe(true);

    // Duplicate registration must return 409 Conflict
    const dupRes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'comisario.alpha@unidadforense.org',
          password: 'OtraPasswordValida1234',
          displayName: 'Clon Alpha',
        }),
      },
      { DB: d1 }
    );
    expect(dupRes.status).toBe(409);
  });

  it('13.3 authenticates via POST /api/auth/login, issues dedicated ses_sec_* MCP tokens, and enforces tenant isolation on /api/mcp/:sessionId', async () => {
    const testVault = new BunSqliteVault(':memory:');
    const d1 = testVault.asD1Database();

    // Register Client A
    const regARes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alpha@cliente-a.io',
          password: 'PasswordClienteA#2026',
          displayName: 'Analista A',
          organizationName: 'Cliente Corporativo A',
          requestedTier: 'ORO_PRO',
        }),
      },
      { DB: d1 }
    );
    expect(regARes.status).toBe(201);

    // Register Client B
    const regBRes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'bravo@cliente-b.io',
          password: 'PasswordClienteB#2026',
          displayName: 'Analista B',
          organizationName: 'Cliente Corporativo B',
          requestedTier: 'PLATINO_ENTERPRISE',
        }),
      },
      { DB: d1 }
    );
    expect(regBRes.status).toBe(201);
    const regB = (await regBRes.json()) as {
      authToken: string;
      client: { tenantId: string };
    };

    // Wrong password for Client A must return 401
    const badLogin = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alpha@cliente-a.io',
          password: 'WrongPassword123',
        }),
      },
      { DB: d1 }
    );
    expect(badLogin.status).toBe(401);

    // Valid login for Client A
    const loginARes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alpha@cliente-a.io',
          password: 'PasswordClienteA#2026',
        }),
      },
      { DB: d1 }
    );
    expect(loginARes.status).toBe(200);
    const loginA = (await loginARes.json()) as {
      authToken: string;
      client: { tenantId: string };
    };
    expect(loginA.client.tenantId).not.toBe(regB.client.tenantId);

    // Client A issues a dedicated ses_sec_* token for 'caso-ransomware'
    const mcpTokenRes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/mcp-tokens',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginA.authToken}`,
        },
        body: JSON.stringify({
          sessionId: 'caso-ransomware',
          title: 'Investigación Ransomware A',
          caseTier: 'PLATINO',
        }),
      },
      { DB: d1 }
    );
    expect(mcpTokenRes.status).toBe(201);
    const mcpTokenJson = (await mcpTokenRes.json()) as {
      ok: boolean;
      sessionToken: string;
      sessionId: string;
      dbSessionId: string;
    };
    expect(mcpTokenJson.sessionToken.startsWith('ses_sec_')).toBe(true);
    expect(mcpTokenJson.dbSessionId).toBe(`${loginA.client.tenantId}:caso-ransomware`);

    // Client A mutates 'caso-ransomware' using its dedicated ses_sec_* token
    const mutateARes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/mcp/caso-ransomware',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mcpTokenJson.sessionToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'cangrejo_session_mutate_graph',
            arguments: {
              action: 'upsert',
              entities: [
                { id: '2001', typeName: 'maltego.Domain', value: 'secret-client-a-only.org' },
              ],
            },
          },
        }),
      },
      { DB: d1 }
    );
    expect(mutateARes.status).toBe(200);

    // Client B queries its own 'caso-ransomware' using its cgrj_usr_* user session token -> must NOT see Client A's entity
    const snapBRes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/mcp/caso-ransomware',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${regB.authToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'cangrejo_session_state',
            arguments: {},
          },
        }),
      },
      { DB: d1 }
    );
    expect(snapBRes.status).toBe(200);
    const snapBJson = (await snapBRes.json()) as {
      result: {
        structuredContent: {
          entities: Array<{ value: string }>;
        };
      };
    };
    const bValues = snapBJson.result.structuredContent.entities.map((e) => e.value);
    expect(bValues).not.toContain('secret-client-a-only.org');

    // Logout Client B and verify token revocation
    const logoutRes = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/logout',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${regB.authToken}` },
      },
      { DB: d1 }
    );
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await cangrejoHonoApp.request(
      'http://127.0.0.1:3000/api/auth/me',
      {
        headers: { Authorization: `Bearer ${regB.authToken}` },
      },
      { DB: d1 }
    );
    expect(meAfterLogout.status).toBe(401);
  });
});
