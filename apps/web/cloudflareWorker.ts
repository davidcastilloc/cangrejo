import type { CloudflareAiBindingLike } from '../../packages/transforms/src/index.js';
import { cangrejoHonoApp } from './honoApp.js';

export interface CangrejoCloudflareEnv {
  AI?: CloudflareAiBindingLike;
  DB?: unknown;
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
 * Cloudflare Workers Edge Entrypoint (`apps/web/cloudflareWorker.ts`).
 * Routes `/api/*` requests through `cangrejoHonoApp` with native `env.AI`, `env.DB`, and
 * `env.VECTORIZE_INDEX` bindings, and serves static workstation assets via `env.ASSETS`.
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
};
