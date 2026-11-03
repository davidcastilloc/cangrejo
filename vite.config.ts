import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

function cangrejoOsintApiPlugin(): Plugin {
  return {
    name: 'cangrejo-osint-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/')) {
          try {
            const mod = (await server.ssrLoadModule('/apps/web/apiServer.ts')) as {
              handleApiRequest: (
                r: IncomingMessage,
                s: ServerResponse
              ) => Promise<boolean>;
            };
            const handled = await mod.handleApiRequest(req, res);
            if (handled) return;
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              })
            );
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [cangrejoOsintApiPlugin()],
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@cangrejo/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@cangrejo/renderer': resolve(__dirname, 'packages/renderer/src/index.ts'),
      '@cangrejo/platform-bridge': resolve(__dirname, 'packages/platform-bridge/src/index.ts'),
      '@cangrejo/schemas': resolve(__dirname, 'packages/schemas/src/index.ts'),
      '@cangrejo/transforms': resolve(__dirname, 'packages/transforms/src/index.ts'),
      '@cangrejo/design-tokens': resolve(__dirname, 'packages/design-tokens/src/index.ts'),
      '@cangrejo/database-d1': resolve(__dirname, 'packages/database-d1/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/target/**', '**/.moon/**', '**/.specify/**', '**/specs/**'],
    },
  },
});
