import { z } from 'zod'
import { type ClaudeClient } from '../claude/client.js'
import { REASONING_MODEL } from '../claude/models.js'
import { callStructured } from '../claude/structured-call.js'
import { type TranscriptEntry } from '../types/transcript.js'

// Shared "what would this persona plausibly say next" generator, used by
// both the local rehearsal harness (demo-rehearsal.ts) and the live
// multi-device persona relay (persona-live.ts) — same decision logic
// either way, only the delivery mechanism (inject into the store vs. send a
// real iMessage) differs between the two runners.
//
// Deliberately reactive-only: every call sees nothing but the transcript
// that's actually happened so far, never any other persona's "planned"
// future lines. That's what keeps timing honest — a line referencing
// something before it's actually been said is a prompt-construction bug,
// not a plausible output, because the model is never given that content.

export interface PersonaProfile {
  name: string
  /** Raw real texts from this person, used only to calibrate tone/rhythm — never quoted directly. */
  textingStyleSample: string
  /** Loose topics to organically work toward, in order — hints, not a script to recite verbatim. */
  topics: string[]
}

const NextLineSchema = z.object({
  should_speak: z.boolean(),
  // Populated only when should_speak is true.
  text: z.string().max(300).optional(),
})

export type NextLineDecision = z.infer<typeof NextLineSchema>

export interface DecideNextLineInput {
  persona: PersonaProfile
  /** Full visible transcript so far, oldest first — this persona sees ONLY this, nothing "planned" ahead. */
  transcript: TranscriptEntry[]
  /** Index into persona.topics of the next topic not yet organically covered. */
  nextTopicIndex: number
  /** True once the buildup arc is exhausted and the group should be trending toward "let's hang out". */
  isClosingStretch: boolean
  client?: ClaudeClient
}

function buildPrompt(input: DecideNextLineInput): string {
  const { persona, transcript, nextTopicIndex, isClosingStretch } = input
  const lines = transcript.map((e) => `[${e.sender}]: ${e.text}`).join('\n') || '(no messages yet)'
  const nextTopic = persona.topics[nextTopicIndex]

  return `You are ${persona.name}, texting in a real group chat with friends. You are NOT an AI assistant and must never sound like one — no "Sure!", no summarizing, no offering help, no perfect grammar/punctuation unless that's genuinely how this person writes.

Here is a real sample of how ${persona.name} actually texts (match the rhythm, casing, punctuation habits, and slang — do not copy any sentence from it verbatim, just the STYLE):
<style_sample>
${persona.textingStyleSample}
</style_sample>

Full conversation so far, oldest first — this is the ONLY context you have; you do not know what anyone is about to say next, and you must never reference anything that hasn't actually been said yet:
<transcript>
${lines}
</transcript>

${nextTopic !== undefined ? `A loose thing you might organically bring up if it fits naturally (do not force it, do not quote this verbatim — just a vibe): "${nextTopic}"` : ''}
${isClosingStretch ? '\nThe conversation has been going a couple of days now — if it feels natural, start trending toward actually making plans to hang out ("we should do something", "what is everyone up to this weekend", etc.) rather than just chatting. Do not force it if the last message does not lend itself to that.' : ''}

Decide: should ${persona.name} say something right now, or would a real person just not respond to this yet (staying silent is very often correct — real people do not reply to every message, and do not reply instantly)? If yes, write ONE short message (or occasionally two very short back-to-back texts joined by a newline, if that is how this person actually texts based on the style sample) that could believably come next. Keep it SHORT — most real texts are under 15 words. Do not restate context, do not use full sentences with perfect capitalization unless the style sample shows that, do not sound like a chatbot.`
}

export async function decideNextLine(input: DecideNextLineInput): Promise<NextLineDecision> {
  return callStructured({
    schema: NextLineSchema,
    messages: [{ role: 'user', content: buildPrompt(input) }],
    model: REASONING_MODEL,
    maxTokens: 300,
    client: input.client,
  })
}
