import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@cangrejo/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@cangrejo/schemas': path.resolve(__dirname, 'packages/schemas/src/index.ts'),
      '@cangrejo/platform-bridge': path.resolve(__dirname, 'packages/platform-bridge/src/index.ts'),
      '@cangrejo/database-d1': path.resolve(__dirname, 'packages/database-d1/src/index.ts'),
      '@cangrejo/renderer': path.resolve(__dirname, 'packages/renderer/src/index.ts'),
      '@cangrejo/transforms': path.resolve(__dirname, 'packages/transforms/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
