import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ClaudeClient, claudeClient } from './client.js'
import { CLASSIFIER_MODEL, REASONING_MODEL } from './models.js'

const STRUCTURED_OUTPUT_TOOL = 'submit_structured_output'

export type ClaudeModel = typeof CLASSIFIER_MODEL | typeof REASONING_MODEL

export class StructuredOutputError extends Error {
  readonly cause: unknown

  constructor(
    readonly code: 'missing_tool_use' | 'validation_failed',
    message: string,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'StructuredOutputError'
    this.cause = cause
  }
}

export interface StructuredCallOptions<T> {
  schema: z.ZodType<T>
  messages: Anthropic.MessageParam[]
  model: ClaudeModel
  maxTokens?: number
  client?: ClaudeClient
}

/**
 * Forced tool use guarantees an object-shaped response; Zod remains the authority
 * for the application's actual contract before the response reaches business logic.
 */
export async function callStructured<T>({
  schema,
  messages,
  model,
  maxTokens = 1_024,
  client = claudeClient,
}: StructuredCallOptions<T>): Promise<T> {
  const response = await client.createMessage({
    model,
    max_tokens: maxTokens,
    messages,
    tool_choice: { type: 'tool', name: STRUCTURED_OUTPUT_TOOL, disable_parallel_tool_use: true },
    tools: [
      {
        name: STRUCTURED_OUTPUT_TOOL,
        description: 'Return the requested structured output exactly once.',
        input_schema: { type: 'object', additionalProperties: true },
        strict: true,
      },
    ],
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === STRUCTURED_OUTPUT_TOOL,
  )

  if (toolUse === undefined) {
    throw new StructuredOutputError(
      'missing_tool_use',
      'Claude did not return the required structured output tool call',
    )
  }

  const result = schema.safeParse(toolUse.input)

  if (!result.success) {
    throw new StructuredOutputError(
      'validation_failed',
      'Claude structured output did not match the required schema',
      result.error,
    )
  }

  return result.data
}
