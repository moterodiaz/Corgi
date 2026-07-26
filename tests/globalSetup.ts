import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testDbPath = path.resolve(rootDir, 'test.db')

export function setup(): void {
  // Push schema to test.db, wiping any prior state for a clean test run.
  // --accept-data-loss needed when SQLite schema changes; safe here because this is test.db.
  execSync('prisma db push --accept-data-loss --skip-generate', {
    cwd: rootDir,
    env: {
      ...process.env,
      DATABASE_URL: 'file:./test.db',
      PATH: `${path.resolve(rootDir, 'node_modules/.bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
    },
    stdio: 'pipe',
  })
}

export function teardown(): void {
  // Remove test.db after the run; ignore only an already-removed file.
  try {
    fs.rmSync(testDbPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}
