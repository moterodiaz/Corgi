import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const completeEnv = {
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  MERGE_API_KEY: 'test-merge-key',
  DATABASE_URL: 'file:./test.db',
  BLUEBUBBLES_SERVER_URL: 'http://127.0.0.1:1234',
  BLUEBUBBLES_SERVER_PASSWORD: 'test-bluebubbles-password',
}

// config.ts does `import 'dotenv/config'`, which — by default — silently
// backfills any env var missing from the spawned process into whatever
// .env file it finds in cwd. Every real dev machine has a real .env (it's
// required for local dev), so without this, the real .env would quietly
// supply the "missing" var and mask the exact failure this test exists to
// catch. Pointing DOTENV_CONFIG_PATH at a file that doesn't exist keeps
// dotenv from loading anything, regardless of the host machine's setup.
const noSuchDotenvPath = join(tmpdir(), 'corgi-config-test-no-such-dotenv-file')

function loadConfig(env: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', "import './src/config.ts'"],
    {
      cwd: process.cwd(),
      env: { ...env, DOTENV_CONFIG_PATH: noSuchDotenvPath },
      encoding: 'utf8',
    },
  )
}

describe('config', () => {
  it('fails startup loudly when a required environment variable is missing', () => {
    const result = loadConfig({ ...completeEnv, ANTHROPIC_API_KEY: undefined })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Invalid environment configuration')
    expect(result.stderr).toContain('ANTHROPIC_API_KEY')
  })

  it('fails startup loudly when a required environment variable is blank', () => {
    const result = loadConfig({ ...completeEnv, MERGE_API_KEY: '' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Invalid environment configuration')
    expect(result.stderr).toContain('MERGE_API_KEY')
  })
})
