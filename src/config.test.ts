import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const completeEnv = {
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  MERGE_API_KEY: 'test-merge-key',
  PHOTON_API_KEY: 'test-photon-key',
  DATABASE_URL: 'file:./test.db',
}

function loadConfig(env: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', "import './src/config.ts'"],
    {
      cwd: process.cwd(),
      env,
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
