import { type ClaudeClient } from '../claude/client.js'
import {
  shouldExtractContext,
  extractContext,
  type ExtractionConfig,
} from '../claude/context-extraction.js'
import { classifyPlanFeedback } from '../claude/plan-feedback.js'
import { synthesizePlan } from '../claude/plan-synthesis.js'
import { classifySpeakNow } from '../claude/speak-classifier.js'
import { transition } from './plan-state-machine.js'
import { getGroupProfile, getPersonProfile } from '../store/profile-repo.js'
import { createPlanVersion, getAllPlanVersions, getLatestPlanForGroup } from '../store/plan-repo.js'
import { appendTranscriptEntry, getTranscriptByGroup } from '../store/transcript-repo.js'
import { type GroupProfile, type PersonProfile } from '../types/profile.js'
import { type Plan } from '../types/plan.js'
import {
  type TransportCardInteraction,
  type TransportInboundMessage,
} from '../transport/TransportPort.js'

// Wires design-doc.md's full inbound loop (§4-9, TASKS.md P5-2) over
// whatever transport is plugged in: transcript append -> periodic context
// extraction -> speak/silent classification -> plan synthesis, plus
// feedback/tapback-driven revision and confirmation. This is the piece that
// makes every individually-tested module (context-extraction, speak
// classifier, plan synthesis, plan state machine) into an actual running
// bot rather than disconnected parts.
//
// Known, deliberate scope gaps (not silently missing — called out here so
// nobody assumes they're covered):
// - No transparency-query handling yet (design-doc §9, TASKS.md P5-3):
//   "how do you know that?" isn't detected/answered specially.
// - The "clarifying" speak-classifier decision doesn't send a question yet
//   — treated the same as "silent" for now, since neither is a functional
//   regression (staying quiet is always a safe default per §7's own bias).
// - Per-person accept-tracking for confirmation lives in memory, not the
//   database — restarting the process loses in-progress RSVP state (the
//   plan/venue history itself is fully recoverable from the DB regardless).

export interface HangoutOrchestratorOutbound {
  sendMessage(input: { groupId: string; text: string }): Promise<unknown>
}

export interface HangoutOrchestratorOptions {
  transport: HangoutOrchestratorOutbound
  claudeClient?: ClaudeClient
  now?: () => number
  extraction?: ExtractionConfig
  /** Recent-transcript window handed to the speak classifier and synthesis prompts. */
  recentMessageWindow?: number
  onError?: (error: unknown, context: { groupId: string; stage: string }) => void
}

interface GroupRuntimeState {
  messagesSinceLastExtraction: number
  lastExtractionAt: number
  knownPersonIds: Set<string>
  acceptedByPlanId: Map<string, Set<string>>
}

const DEFAULT_RECENT_WINDOW = 30

function defaultGroupProfile(groupId: string, now: number): GroupProfile {
  return {
    group_id: groupId,
    shared_interests: [],
    initiators: [],
    followers: [],
    sentiment_notes: [],
    updated_at: now,
  }
}

function defaultOnError(error: unknown, context: { groupId: string; stage: string }): void {
  console.error(
    `[hangout-orchestrator] ${context.stage} failed for group ${context.groupId}`,
    error,
  )
}

export class HangoutOrchestrator {
  private readonly transport: HangoutOrchestratorOutbound
  private readonly claudeClient: ClaudeClient | undefined
  private readonly now: () => number
  private readonly extractionConfig: ExtractionConfig
  private readonly recentMessageWindow: number
  private readonly onError: (error: unknown, context: { groupId: string; stage: string }) => void
  private readonly groupState = new Map<string, GroupRuntimeState>()

  constructor(options: HangoutOrchestratorOptions) {
    this.transport = options.transport
    this.claudeClient = options.claudeClient
    this.now = options.now ?? Date.now
    this.extractionConfig = options.extraction ?? {}
    this.recentMessageWindow = options.recentMessageWindow ?? DEFAULT_RECENT_WINDOW
    this.onError = options.onError ?? defaultOnError
  }

  /** Attach directly to a transport's onMessage/onCardInteraction. */
  async handleMessage(message: TransportInboundMessage): Promise<void> {
    try {
      await this.processMessage(message)
    } catch (error) {
      this.onError(error, { groupId: message.groupId, stage: 'handleMessage' })
    }
  }

  async handleCardInteraction(interaction: TransportCardInteraction): Promise<void> {
    try {
      await this.processCardInteraction(interaction)
    } catch (error) {
      this.onError(error, { groupId: interaction.groupId, stage: 'handleCardInteraction' })
    }
  }

  // Warms up "who's in this group" for a group whose transcript already has
  // history the orchestrator never processed message-by-message (e.g. after
  // a process restart, or a rehearsal harness replaying buildup chatter
  // straight into the transcript store). Without this, profiles for people
  // who haven't sent a message *through* the orchestrator yet are excluded
  // from synthesis even though their transcript history already exists.
  primeKnownPersons(groupId: string, personIds: readonly string[]): void {
    const state = this.stateFor(groupId)
    for (const personId of personIds) state.knownPersonIds.add(personId)
  }

  private stateFor(groupId: string): GroupRuntimeState {
    const existing = this.groupState.get(groupId)
    if (existing !== undefined) return existing
    const created: GroupRuntimeState = {
      messagesSinceLastExtraction: 0,
      lastExtractionAt: this.now(),
      knownPersonIds: new Set(),
      acceptedByPlanId: new Map(),
    }
    this.groupState.set(groupId, created)
    return created
  }

  private async loadActivePlan(groupId: string): Promise<Plan | null> {
    const latest = await getLatestPlanForGroup(groupId)
    if (latest === null || latest.status === 'abandoned') return null
    return latest
  }

  private async loadPersonProfiles(
    groupId: string,
    personIds: ReadonlySet<string>,
  ): Promise<PersonProfile[]> {
    const profiles = await Promise.all(
      Array.from(personIds).map((personId) => getPersonProfile(personId, groupId)),
    )
    return profiles.filter((p): p is PersonProfile => p !== null)
  }

  private async maybeExtractContext(groupId: string, state: GroupRuntimeState): Promise<void> {
    const shouldRun = shouldExtractContext(
      {
        messagesSinceLastExtraction: state.messagesSinceLastExtraction,
        msSinceLastExtraction: this.now() - state.lastExtractionAt,
      },
      this.extractionConfig,
    )
    if (!shouldRun) return

    try {
      const entries = await getTranscriptByGroup(groupId)
      await extractContext(entries, groupId, Array.from(state.knownPersonIds), this.claudeClient)
    } finally {
      // Reset even on failure — an extraction that errors shouldn't be
      // retried on every single subsequent message; it'll run again once
      // the threshold is reached fresh.
      state.messagesSinceLastExtraction = 0
      state.lastExtractionAt = this.now()
    }
  }

  private async rejectedVenueRefIds(groupId: string, plan: Plan): Promise<string[]> {
    const versions = await getAllPlanVersions(groupId, plan.plan_id)
    return Array.from(new Set(versions.map((v) => v.venue.ref_id)))
  }

  private async processMessage(message: TransportInboundMessage): Promise<void> {
    const { groupId } = message

    await appendTranscriptEntry({
      groupId,
      sender: message.senderId,
      text: message.text,
      timestamp: message.receivedAt.toISOString(),
    })

    const state = this.stateFor(groupId)
    state.knownPersonIds.add(message.senderId)
    state.messagesSinceLastExtraction += 1

    const activePlan = await this.loadActivePlan(groupId)

    if (activePlan !== null) {
      const feedback = await classifyPlanFeedback({
        plan: activePlan,
        message: message.text,
        senderId: message.senderId,
        client: this.claudeClient,
      })

      if (feedback.is_feedback_on_plan) {
        await this.applyFeedback(
          groupId,
          activePlan,
          feedback.sentiment,
          feedback.reason,
          message.senderId,
        )
        await this.maybeExtractContext(groupId, state)
        return
      }
    }

    await this.maybeExtractContext(groupId, state)

    if (activePlan !== null) {
      // A plan is already live and this message wasn't feedback on it —
      // don't propose a second, competing plan on top of it.
      return
    }

    const entries = await getTranscriptByGroup(groupId)
    const recent = entries.slice(-this.recentMessageWindow)
    const personProfiles = await this.loadPersonProfiles(groupId, state.knownPersonIds)

    const decision = await classifySpeakNow({
      entries: recent,
      profiles: personProfiles,
      groupSize: state.knownPersonIds.size,
      minutesSinceLastMessage: 0,
      client: this.claudeClient,
    })

    if (decision.decision !== 'propose') return

    const groupProfile =
      (await getGroupProfile(groupId)) ?? defaultGroupProfile(groupId, this.now())
    const { message: text } = await synthesizePlan({
      groupProfile,
      personProfiles,
      currentPlan: null,
      groupId,
      client: this.claudeClient,
    })

    await this.transport.sendMessage({ groupId, text })
  }

  private async processCardInteraction(interaction: TransportCardInteraction): Promise<void> {
    const activePlan = await this.loadActivePlan(interaction.groupId)
    if (activePlan === null) return

    if (interaction.action === 'accept') {
      await this.applyFeedback(
        interaction.groupId,
        activePlan,
        'accept',
        undefined,
        interaction.senderId,
      )
      return
    }

    const reason =
      interaction.action === 'suggest-alternative'
        ? 'asked for a different suggestion (reaction)'
        : 'reacted negatively to the plan'
    await this.applyFeedback(
      interaction.groupId,
      activePlan,
      'reject',
      reason,
      interaction.senderId,
    )
  }

  private async applyFeedback(
    groupId: string,
    plan: Plan,
    sentiment: 'accept' | 'reject' | 'neutral',
    reason: string | undefined,
    senderId: string,
  ): Promise<void> {
    if (sentiment === 'neutral') return

    const state = this.stateFor(groupId)

    if (sentiment === 'accept') {
      const accepted = state.acceptedByPlanId.get(plan.plan_id) ?? new Set<string>()
      accepted.add(senderId)
      state.acceptedByPlanId.set(plan.plan_id, accepted)

      const everyoneKnownHasAccepted =
        state.knownPersonIds.size > 0 &&
        Array.from(state.knownPersonIds).every((id) => accepted.has(id))

      if (!everyoneKnownHasAccepted || plan.status === 'confirmed') return

      const confirmedResult = transition(plan, 'confirm')
      if ('error' in confirmedResult) return
      const confirmed = await createPlanVersion(groupId, confirmedResult)
      await this.transport.sendMessage({
        groupId,
        text: renderConfirmationText(confirmed),
      })
      return
    }

    // sentiment === 'reject'
    const revisingResult = transition(plan, 'feedback_full_reject')
    if ('error' in revisingResult) return
    const revising = await createPlanVersion(groupId, revisingResult)
    state.acceptedByPlanId.delete(plan.plan_id)

    const groupProfile =
      (await getGroupProfile(groupId)) ?? defaultGroupProfile(groupId, this.now())
    const personProfiles = await this.loadPersonProfiles(groupId, state.knownPersonIds)
    const excludeVenueRefIds = await this.rejectedVenueRefIds(groupId, plan)

    const { plan: revisedPlan, message: text } = await synthesizePlan({
      groupProfile,
      personProfiles,
      currentPlan: revising,
      groupId,
      client: this.claudeClient,
      feedback: reason,
      excludeVenueRefIds,
    })
    state.acceptedByPlanId.set(revisedPlan.plan_id, new Set())

    await this.transport.sendMessage({ groupId, text })
  }
}

function renderConfirmationText(plan: Plan): string {
  return `🎉 Locked in! ${plan.activity} at ${plan.venue.name}, ${formatDateTime(plan.datetime)}. See you all there.`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
