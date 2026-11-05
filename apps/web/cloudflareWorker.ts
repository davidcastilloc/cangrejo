import type {
  CloudflareD1DatabaseLike,
  CloudflareR2BucketLike,
} from '../../packages/database-d1/src/index.js';
import type { CloudflareAiBindingLike } from '../../packages/transforms/src/index.js';
import { cangrejoHonoApp, runScheduledRadarScan } from './honoApp.js';

export interface DurableObjectIdLike {
  toString(): string;
}

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

export interface CangrejoCloudflareEnv {
  AI?: CloudflareAiBindingLike;
  DB?: CloudflareD1DatabaseLike;
  CANGREJO_VAULT_R2?: CloudflareR2BucketLike;
  SESSION_ROOM_DO?: DurableObjectNamespaceLike;
  VECTORIZE_INDEX?: {
    query(vector: number[] | Float32Array, options?: Record<string, unknown>): Promise<unknown>;
    upsert(vectors: Array<Record<string, unknown>>): Promise<unknown>;
  };
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  AI_GATEWAY_SLUG?: string;
}

export interface CloudflareExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

/**
 * Stateful Durable Object (`CangrejoSessionRoomDO`) pinning a given collaboration / MCP
 * session room (`roomId`) to a single global Cloudflare isolate so in-memory SSE streams
 * (`/api/collab/rooms/:roomId/stream`) and MCP tool calls (`/api/mcp/:sessionId`) share
 * real-time state across all connected clients worldwide.
 */
export class CangrejoSessionRoomDO {
  public constructor(
    public readonly ctx: unknown,
    public readonly env: CangrejoCloudflareEnv
  ) {}

  public async fetch(request: Request): Promise<Response> {
    return await cangrejoHonoApp.fetch(request, this.env);
  }
}

export function resolveSessionRoomFromRequest(request: Request, url: URL): string | null {
  const collabMatch = url.pathname.match(/^\/api\/collab\/rooms\/([^/]+)/);
  if (collabMatch?.[1]) {
    return decodeURIComponent(collabMatch[1]).trim() || 'expediente-apt29';
  }
  const mcpPathMatch = url.pathname.match(/^\/api\/mcp\/([^/]+)/);
  if (mcpPathMatch?.[1]) {
    return decodeURIComponent(mcpPathMatch[1]).trim() || 'expediente-apt29';
  }
  if (url.pathname === '/api/mcp') {
    const qRoom = url.searchParams.get('session') ?? url.searchParams.get('room');
    const hRoom =
      request.headers.get('x-cangrejo-session') ?? request.headers.get('mcp-session-id');
    const resolved = (qRoom ?? hRoom ?? '').trim();
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Cloudflare Workers Edge Entrypoint (`apps/web/cloudflareWorker.ts`).
 * Routes `/api/*` requests through `cangrejoHonoApp` (and stateful room/MCP traffic through
 * `SESSION_ROOM_DO` when bound) with native `env.AI`, `env.DB`, and `env.VECTORIZE_INDEX`
 * bindings, and serves static workstation assets via `env.ASSETS`.
 */
export default {
  async fetch(
    request: Request,
    env: CangrejoCloudflareEnv,
    ctx?: CloudflareExecutionContextLike
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        if (env.SESSION_ROOM_DO) {
          const roomId = resolveSessionRoomFromRequest(request, url);
          if (roomId) {
            const doId = env.SESSION_ROOM_DO.idFromName(roomId);
            return await env.SESSION_ROOM_DO.get(doId).fetch(request);
          }
        }
        return await cangrejoHonoApp.fetch(request, env, ctx as never);
      }

      if (env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
        return await env.ASSETS.fetch(request);
      }

      return await cangrejoHonoApp.fetch(request, env, ctx as never);
    } catch (err) {
      console.error('[CloudflareWorker] Unhandled edge error:', err);
      return Response.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 500 }
      );
    }
  },
  async scheduled(
    _controller: unknown,
    env: CangrejoCloudflareEnv,
    ctx?: CloudflareExecutionContextLike
  ): Promise<void> {
    const promise = runScheduledRadarScan(env.DB);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(promise);
    } else {
      await promise;
    }
  },
};
