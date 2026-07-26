import Anthropic, { APIConnectionTimeoutError, type ClientOptions } from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
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

export class ClaudeOutputError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'ClaudeOutputError'
  }
}

export interface StructuredClaudeRequest<T extends z.ZodTypeAny> {
  model: string
  system: string
  user: string
  schema: T
  toolName: string
}

export interface StructuredClaudeClient {
  call<T extends z.ZodTypeAny>(request: StructuredClaudeRequest<T>): Promise<z.infer<T>>
}

/** Forces a Claude tool call, then validates its input before E2 business logic sees it. */
export class ClaudeStructuredClient implements StructuredClaudeClient {
  constructor(private readonly client: Pick<ClaudeClient, 'createMessage'> = claudeClient) {}

  async call<T extends z.ZodTypeAny>(request: StructuredClaudeRequest<T>): Promise<z.infer<T>> {
    const response = await this.client.createMessage({
      model: request.model,
      max_tokens: 1_024,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      tools: [{
        name: request.toolName,
        description: 'Return the requested structured result.',
        input_schema: zodToJsonSchema(request.schema) as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: request.toolName },
    })
    const use = response.content.find(
      (block) => block.type === 'tool_use' && block.name === request.toolName,
    )
    if (!use || use.type !== 'tool_use') {
      throw new ClaudeOutputError(`Claude did not call required tool ${request.toolName}`)
    }
    const parsed = request.schema.safeParse(use.input)
    if (!parsed.success) {
      throw new ClaudeOutputError(`Claude returned invalid ${request.toolName} output`, parsed.error)
    }
    return parsed.data
  }
}
