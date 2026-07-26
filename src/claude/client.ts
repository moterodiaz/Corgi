import Anthropic, { APIConnectionTimeoutError, type ClientOptions } from '@anthropic-ai/sdk'
import { config } from '../config.js'

export const CLAUDE_TIMEOUT_MS = 30_000

export type ClaudeCallErrorCode = 'timeout' | 'request_failed'

export class ClaudeCallError extends Error {
  readonly cause: unknown

  constructor(
    readonly code: ClaudeCallErrorCode,
    message: string,
    cause: unknown,
  ) {
    super(message)
    this.name = 'ClaudeCallError'
    this.cause = cause
  }
}

export interface ClaudeClientOptions {
  baseURL?: string
  fetch?: ClientOptions['fetch']
  timeoutMs?: number
}

/** Thin boundary around the SDK so all Claude requests share timeout and failure behavior. */
export class ClaudeClient {
  private readonly client: Anthropic
  private readonly timeoutMs: number

  constructor(options: ClaudeClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? CLAUDE_TIMEOUT_MS

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError('Claude timeout must be a positive number of milliseconds')
    }

    this.client = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: 0,
      timeout: this.timeoutMs,
    })
  }

  async createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    try {
      return await this.client.messages.create(params, { timeout: this.timeoutMs })
    } catch (cause) {
      if (cause instanceof APIConnectionTimeoutError) {
        throw new ClaudeCallError('timeout', 'Claude request timed out', cause)
      }

      throw new ClaudeCallError('request_failed', 'Claude request failed', cause)
    }
  }
}

export const claudeClient = new ClaudeClient()
