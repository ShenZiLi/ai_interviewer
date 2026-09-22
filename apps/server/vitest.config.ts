import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    },
  },
  test: {
    include: ['**/*.spec.ts'],
    // 回归测试必须隔离本机 `.data` 的模型配置与持久化数据，始终使用 Mock provider / 纯内存仓库。
    env: { NODE_ENV: 'test', VITEST: 'true' },
    // Nest/Fastify e2e suites share process-level module state; run files serially
    // until the M2 user-scoped application factory is introduced.
    fileParallelism: false,
  },
});
