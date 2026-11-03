import fs from 'node:fs';
import path from 'node:path';
import { cangrejoHonoApp } from './honoApp.js';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/**
 * Creates a unified Web-Standard `fetch(req: Request): Promise<Response>` handler for `Bun.serve`,
 * Cloudflare Pages/Workers, or Node.js HTTP adapters.
 * Routes `/api/*` directly to `cangrejoHonoApp` and serves compiled static assets from `distDir`.
 */
export function createCangrejoProductionFetchHandler(
  distDir = path.resolve(process.cwd(), 'dist')
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // 1. Route all API endpoints through the Hono Web-Standard router
    if (url.pathname.startsWith('/api/')) {
      return await cangrejoHonoApp.fetch(req);
    }

    // 2. Serve static files from distDir (with path traversal prevention)
    const relativePath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const candidatePath = path.resolve(distDir, relativePath);
    if (!candidatePath.startsWith(path.resolve(distDir))) {
      return new Response('Forbidden', { status: 403 });
    }

    const targetFile =
      fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
        ? candidatePath
        : path.resolve(distDir, 'index.html');

    if (!fs.existsSync(targetFile)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Static bundle not found. Run `bun run build` first.',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }
      );
    }

    const ext = path.extname(targetFile).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const bytes = fs.readFileSync(targetFile);

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-Cangrejo-Engine': 'Cangrejo-Oro-v1.0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}

// Start standalone Bun.serve server when executed directly (`bun run apps/web/bunServer.ts`)
const g = globalThis as Record<string, unknown>;
if (
  typeof g.Bun !== 'undefined' &&
  (import.meta as unknown as { main?: boolean }).main === true
) {
  const bunObj = g.Bun as {
    serve: (opts: { port: number; hostname: string; fetch: (req: Request) => Promise<Response> }) => {
      port: number;
      hostname: string;
    };
  };
  const port = Number(process.env.PORT ?? 8787);
  const server = bunObj.serve({
    port,
    hostname: '127.0.0.1',
    fetch: createCangrejoProductionFetchHandler(),
  });
  console.log(
    `🦀 CANGREJO Production Server (Bun.serve + Hono + bun:sqlite) listening on http://${server.hostname}:${server.port}`
  );
}
