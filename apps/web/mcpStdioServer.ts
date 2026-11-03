import readline from 'node:readline';
import { cangrejoHonoApp } from './honoApp.js';

/**
 * Dispatches a single newline-delimited MCP JSON-RPC 2.0 payload either to a running
 * CANGREJO workstation (`CANGREJO_MCP_URL`, default `http://127.0.0.1:3000/api/mcp`)
 * or directly in-process via `cangrejoHonoApp.request('/api/mcp')`.
 */
export async function dispatchMcpJsonRpcLine(
  rawLine: string,
  targetUrl = process.env.CANGREJO_MCP_URL
): Promise<string | null> {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as { id?: unknown; method?: string };
  if (parsed.id === undefined && String(parsed.method ?? '').startsWith('notifications/')) {
    return null;
  }

  if (targetUrl) {
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: trimmed,
      });
      return JSON.stringify(await res.json());
    } catch {
      // Fallback to in-process Hono app when standalone HTTP server is offline
    }
  }

  const localRes = await cangrejoHonoApp.request('/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
