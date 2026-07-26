import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'

describe('GET /health', () => {
  let server: FastifyInstance

  beforeAll(async () => {
    server = await buildServer()
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
  })

  it('returns 200 with { status: "ok" }', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('returns 404 for an unknown route', async () => {
    const res = await server.inject({ method: 'GET', url: '/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })
})
