# Hangout Planner Agent — Design Doc

**Hackathon theme:** Making AI feel human
**One-liner:** An ambient AI agent that lives in an iMessage group chat, quietly learns what the group actually wants, and proposes a real plan — then adjusts it like a friend would.

---

## 1. Overview

The agent joins a group chat with no prior context. It listens passively, builds an evolving model of the group's interests, constraints, and mood, and — when the moment is right — proposes a concrete hangout plan sourced from real local events/venues. The group can push back in plain language ("too expensive," "Sam can't do Saturday") and the agent revises the plan rather than starting over. A native iMessage widget (mini-app card) shows the current plan, RSVPs, and lets people tap to accept/veto without typing.

Stack:
- **Photon (Spectrum SDK)** — iMessage transport: reading the group chat stream, sending messages, and rendering the interactive mini-app card widget.
- **Merge (Unified API / Agent Handler)** — connects the agent's reasoning layer to external tools/data (calendars for availability, and any event/venue data sources the team wires up as tools).
- **Claude** — context extraction, "should I speak now" classification, plan synthesis, and feedback-diff reasoning.

---

## 2. Goals / Non-goals

**Goals**
- Feel like a thoughtful friend, not a scheduling bot — low frequency, high relevance.
- Demonstrate visible "learning" — the agent should be able to explain what it picked up on, on request.
- Handle the full loop live in the demo: chat → silent learning → proposed plan → pushback → revised plan → confirmed plan.
- Ship a working iMessage widget, since that's a strong "feels human / feels native" demo beat.

**Non-goals (for hackathon scope)**
- No persistent cross-group learning (each group chat is its own isolated context).
- No payment/booking execution — the agent proposes and links out; it doesn't purchase tickets or make reservations.
- No multi-platform support (WhatsApp/Telegram) even though Spectrum supports it — iMessage only for the demo.

---

## 3. System Architecture

```
 iMessage Group Chat
        │  (messages, reactions, widget taps)
        ▼
 Photon / Spectrum SDK  ──(webhook: new message / card interaction)──►  Backend (Flask/FastAPI)
        ▲                                                                     │
        │  sendMessage / mini-app card update                                ▼
        └───────────────────────────────────────────────────    Orchestrator (state machine)
                                                                             │
                                          ┌──────────────────────────────────┼───────────────────────────┐
                                          ▼                                  ▼                            ▼
                                Context Extraction Layer          Plan Synthesis Layer            Feedback/Diff Layer
                                (Claude call, structured JSON)    (Claude + retrieval over          (Claude call, plan-state
                                                                    events/venues via Merge tools)   patch, not full regen)
                                          │                                  │                            │
                                          ▼                                  ▼                            ▼
                                 Group/Person Profile Store         Merge Agent Handler tools      Plan Object Store
                                 (SQLite/Postgres)                  (calendar availability,        (structured JSON,
                                                                     local events/venues data)       versioned)
```

Everything the agent "knows" is represented as explicit state (profiles + plan object), not just chat history — this is what makes the feedback loop reliable instead of re-deriving intent from scratch every time.

---

## 4. Photon / Spectrum Integration

Spectrum is the layer that lets the agent live inside the actual iMessage thread without anyone downloading an app — critical for the "feels human, not a bot you install" framing.

**Ingestion**
- Use Spectrum's webhook delivery (recommended over the gateway/streaming listener for a hackathon — no long-lived connection to babysit): each new group message hits our backend as signed JSON.
- Every inbound message is appended to a rolling transcript buffer per group, tagged with sender.

**Output**
- Plain-text proposals and clarifying questions go out via standard `sendMessage`.
- The plan itself renders as a **mini-app card** — Spectrum's live, interactive card format that supports in-place updates. This means when the plan changes (new venue, new time), we update the *same* card in the thread instead of spamming a new message — much closer to how a person would edit a shared plan than to a bot re-posting.
- Use built-in structured message helpers where they fit (e.g. a lightweight poll-style component) for quick binary asks like "does Saturday work?" instead of making people type prose.

**Card interactions**
- Card taps (👍 attending / 👎 can't make it / "suggest something else") come back through the same webhook path as an interaction event, distinct from a text message — route these directly into the Feedback/Diff Layer rather than back through free-text NLU, since they're already structured signal.

**Design note:** because Spectrum has no message-history/pagination API, the agent's "memory" of the chat must be built incrementally from the live stream starting the moment it's added — reinforce that in context extraction (see §6) so there's no assumption of backfilled history.

---

## 5. Merge Integration

Merge sits between the reasoning layer and the outside world, so the agent doesn't need bespoke integration code per data source or per person's calendar.

**Two things Merge is doing here:**
1. **Availability signal** — if/when a friend connects a calendar, Merge's unified API layer normalizes that into a single interface the agent can query for busy/free windows, instead of the agent inferring availability purely from chat text like "I'm slammed this week." (Chat-text inference remains the fallback — not everyone will connect a calendar at a hackathon demo.)
2. **Local events/venues as agent tools** — expose the team's local-events/establishments data source (whatever's plugged in — a curated dataset, Yelp-like source, ticketing API, etc.) as a tool via Merge's Agent Handler, so plan synthesis calls a normalized tool interface ("search_venues", "search_events") rather than hand-rolled API clients per source. This also means swapping or adding a data source later doesn't touch the reasoning layer.

**Why this matters for the demo:** it lets the team say "the agent can reason over calendars *and* real venues *and* whatever we plug in next" without having built three separate integrations — which is a good story for judges even if only one or two sources are wired up live.

---

## 6. Context Extraction Layer

Runs periodically (every N messages, or every few hours of activity — whichever comes first) rather than on every message, both for cost and because per-message extraction overreacts to noise.

Extracts into a structured, incrementally-updated profile:

**Per-person:**
- Interests/activities mentioned (with rough recency/confidence, not permanent facts — someone mentioning climbing once is weaker signal than mentioning it three times)
- Budget signals ("I'm broke this month")
- Constraints (dietary, mobility, "can't do late nights")
- Availability mentions (as fallback to calendar data)

**Group-level:**
- Shared interests / running jokes worth referencing in plan phrasing
- Who tends to initiate vs. go along
- Sentiment on past hangouts, if mentioned

This is stored as versioned JSON per group, not re-derived from full transcript each time — cheap to update, and gives a natural "here's what I've picked up on so far" answer if someone asks the agent directly (see §9, transparency).

---

## 7. "Should I speak now?" Trigger

This is the single highest-leverage piece for feeling human rather than intrusive. A dedicated classifier call (cheap, frequent) looks at recent messages and decides: **silent / clarifying question / propose plan**.

Signals that push toward proposing:
- Explicit planning language ("we should hang out," "what should we do this weekend")
- Enough accumulated profile confidence across enough people in the group
- A lull after planning-adjacent talk (people trailed off without landing on something)

Signals that push toward staying silent:
- Pure reminiscing/joking with no forward-looking intent
- Very recent unresolved disagreement (don't interrupt an argument with a suggestion)
- Insufficient profile coverage (only 1 of 5 people have said anything usable)

Default bias: **wait longer than feels necessary.** An agent that proposes too early reads as eager/annoying; one that waits for a clear opening reads as attentive.

---

## 8. Plan Synthesis & the Plan Object

The plan is never just a chat message — it's a structured object, which is what makes revision reliable:

```json
{
  "plan_id": "uuid",
  "version": 3,
  "status": "proposed",  // proposed | revising | confirmed | abandoned
  "activity": "climbing gym session",
  "venue": { "name": "...", "source_tool": "merge_search_venues", "ref_id": "..." },
  "datetime": "2026-08-02T14:00:00-07:00",
  "cost_tier": "low",
  "attendees": { "sam": "yes", "jess": "pending", "alex": "no" },
  "rationale": "Sam mentioned wanting to try climbing; Jess is tight on budget this month so kept it low-cost; picked Saturday since no one flagged a conflict."
}
```

Synthesis prompt takes: group/person profiles + retrieved venue/event candidates (via Merge tools) + current plan object (if revising) → produces an updated plan object + a human-readable message for the chat. The rationale field is what gets voiced in the proposal message — this is the "genuine, thoughtful friend" tone, not just a logistics dump.

---

## 9. Feedback / Revision Loop

Chat replies and card-tap interactions after a plan is proposed route to a **diff-style prompt**: given the current plan object + the new feedback, output only the fields that should change, plus updated rationale. This avoids re-deriving the whole plan from raw chat history on every round of feedback, which is both cheaper and less prone to accidentally discarding parts of the plan nobody complained about.

Distinguish feedback types:
- **Hard constraint change** ("Sam can't do Saturday") → must revise that field, re-check other constraints still hold
- **Preference nudge** ("something cheaper?") → search Merge tools again with tightened filters
- **Full reject** ("let's do something totally different") → new synthesis pass, but keep learned profile

**Transparency:** if anyone asks "how do you know that?" or "what have you picked up on?", the agent should be able to answer plainly from the stored profile — this is the deliberate answer to the "AI silently profiling my friends" discomfort. Being askable, not just being right, is part of the human-feeling design.

---

## 10. Tech Stack

- **Backend:** Flask or FastAPI (FastAPI if webhook concurrency matters at demo scale)
- **Storage:** SQLite for the hackathon (group profiles, person profiles, plan objects, transcript buffer) — Postgres if there's time
- **Transport:** Photon/Spectrum SDK — webhook mode for ingestion, mini-app card for the widget, standard send for text
- **Tool layer:** Merge Agent Handler for venue/event search + (optional) calendar availability
- **Reasoning:** Claude for context extraction, speak/silent classification, plan synthesis, and feedback-diff
- **Demo safety net:** seed a realistic fake group chat + a small curated local-venues dataset rather than depending on live event APIs during the demo

---

## 11. Demo Script (suggested)

1. Show a pre-seeded group chat scrolling with normal friend chatter (interests, a mention of budget, a mention of wanting to try something new) — agent silent throughout, no card yet.
2. Someone types "we should really hang out soon" — short pause, then the agent posts a **mini-app card** with a proposed plan and rationale.
3. Someone taps 👎 / types "too expensive" — card updates in place (not a new message) with a revised, cheaper plan.
4. Someone asks the agent "wait how'd you know I wanted to try climbing?" — agent answers from its stored profile, demonstrating transparency.
5. Group taps 👍 all around — card status flips to confirmed.

---

## 12. Open Risks / Things to Nail Down Early

- **Spectrum webhook reliability under demo network conditions** — test this early, not night-of.
- **Card update semantics** — confirm in-place update behavior works as expected before building the revision UX around it.
- **Classifier false-positive rate** for "should I speak now" — this will need real tuning against sample transcripts, it's the difference between charming and annoying.
- **Data source for venues/events** — decide early whether this is a real Merge-connected source or a seeded static dataset for demo reliability.
