# E2 — Reasoning implementation notes

## Completed

- P3-1: Claude client wrapper with central model IDs, forced tool output, Zod validation, timeout, and explicit malformed/failure handling.
- P3-2: classifier contract and prompt for `silent`, `clarifying`, and `propose` decisions, with a deliberate silence-first system instruction.
- P3-3: periodic extraction trigger, context-delta contract, group scoping guard, and confidence/recency-aware profile merging.
- P3-4: validated candidate-to-versioned-plan synthesis seam. Retrieval remains an injected validated candidate list until P4-5 connects Merge tools.
- P3-5: minimal feedback patching with separate hard-constraint, preference, and full-reject paths; a full rejection leaves plan and profiles untouched and returns a request for new synthesis.
- Follow-up correctness review: partial RSVP patches preserve every uninvolved attendee; hard constraints may change any affected plan field (not only time); synthesis rejects cross-group profile input; and plan revisions cannot replace a plan ID.
- A hard constraint or preference nudge now tells the orchestrator whether it must refresh venue/time candidates. When no precise alternative is available, the model must mark the affected attendee pending rather than emit an invalid empty patch.

## Foundation exception

`main` contained only documentation: no Phase 0 project scaffold and no Phase 1 schemas/Prisma repository. This branch adds the minimum shared Zod contracts and an in-memory `ReasoningRepository` needed to build and test E2. These are deliberately isolated behind `src/store/repository.ts` so P1's Prisma repository can replace the implementation without changing reasoning callers.

## Clarifications required before merge/integration

1. **Phase 1 ownership:** Should these local schemas/repository seam be replaced wholesale by the eventual P1 implementation, or should this branch become the source for P1's contracts? The plan says P1 must land first, so this branch necessarily violates that sequencing to make progress from the empty repository.
2. **Model IDs:** `claude-sonnet-5` and the specified Haiku ID are taken verbatim from `TECH_STACK.md`; their availability should be confirmed with the Anthropic account before production use.
3. **Extraction schedule state:** `shouldExtractContext` is pure; P5 must persist `messagesSinceLastExtraction` and `lastExtractionAt` per group and reset the count after successful extraction.
4. **Full rejection:** P3-5 intentionally does not synthesize in the diff layer. The orchestrator must retain the group/person profiles and call P3-4 with a new candidate search after it receives `requiresSynthesis: true`.
5. **Feedback source:** the interface currently accepts text only. P5 should convert card interactions to bounded structured feedback before calling it, as required by §4/§9.
