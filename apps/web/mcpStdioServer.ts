import readline from 'node:readline';
import { cangrejoHonoApp } from './honoApp.js';

/**
 * Dispatches a single newline-delimited MCP JSON-RPC 2.0 payload either to a running
 * CANGREJO workstation (`CANGREJO_MCP_URL`, default `http://127.0.0.1:3000/api/mcp`)
 * with optional `CANGREJO_SESSION_ID` and `CANGREJO_MCP_TOKEN` (Bearer authentication),
 * or directly in-process via `cangrejoHonoApp.request(...)`.
 */
export async function dispatchMcpJsonRpcLine(
  rawLine: string,
  targetUrl = process.env.CANGREJO_MCP_URL,
  options?: {
    sessionId?: string;
    token?: string;
  }
): Promise<string | null> {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as { id?: unknown; method?: string };
  if (parsed.id === undefined && String(parsed.method ?? '').startsWith('notifications/')) {
    return null;
  }

  const sessionId = (options?.sessionId ?? process.env.CANGREJO_SESSION_ID ?? '').trim();
  const token = (options?.token ?? process.env.CANGREJO_MCP_TOKEN ?? '').trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  const appendSessionSlug = (baseUrl: string): string => {
    if (!sessionId) return baseUrl;
    const cleanBase = baseUrl.replace(/\/+$/, '');
    if (cleanBase.endsWith(`/api/mcp/${sessionId}`)) return cleanBase;
    if (cleanBase.endsWith('/api/mcp')) return `${cleanBase}/${encodeURIComponent(sessionId)}`;
    return cleanBase;
  };

  if (targetUrl) {
    try {
      const resolvedUrl = appendSessionSlug(targetUrl);
      const res = await fetch(resolvedUrl, {
        method: 'POST',
        headers,
        body: trimmed,
      });
      return JSON.stringify(await res.json());
    } catch {
      // Fallback to in-process Hono app when standalone HTTP server is offline
    }
  }

  const localPath = sessionId ? `/api/mcp/${encodeURIComponent(sessionId)}` : '/api/mcp';
  const localRes = await cangrejoHonoApp.request(localPath, {
    method: 'POST',
    headers,
    body: trimmed,
  });
  return JSON.stringify(await localRes.json());
}

const g = globalThis as Record<string, unknown>;
if (
  typeof g.Bun !== 'undefined' &&
  (import.meta as unknown as { main?: boolean }).main === true
) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    try {
      const out = await dispatchMcpJsonRpcLine(
        line,
        process.env.CANGREJO_MCP_URL ?? 'http://127.0.0.1:3000/api/mcp'
      );
      if (out) process.stdout.write(`${out}\n`);
    } catch (err) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: err instanceof Error ? err.message : String(err) },
        })}\n`
      );
    }
  });
}
