import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    },
  },
  test: {
    include: ['**/*.spec.ts'],
    // Nest/Fastify e2e suites share process-level module state; run files serially
    // until the M2 user-scoped application factory is introduced.
    fileParallelism: false,
  },
});
