import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Run test files sequentially to avoid SQLite concurrent-write races
    // ponytail: single worker, switch to parallel if tests grow beyond ~60s
    maxWorkers: 1,
    minWorkers: 1,
    globalSetup: ['./tests/globalSetup.ts'],
    // Env vars for all test workers — dummy values satisfy config.ts Zod schema
    env: {
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      MERGE_API_KEY: 'test-merge-key',
      PHOTON_API_KEY: 'test-photon-key',
      DATABASE_URL: 'file:./test.db',
    },
  },
})
