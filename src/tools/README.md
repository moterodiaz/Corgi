# Tools integration contract

This directory is intentionally self-contained while the shared P0/P1
foundation is still in flight. Integration should preserve the exported
behavior, then adapt imports and persistence to the frozen shared contracts.

## Live venue and event search

1. Create a free Tavily API key and set `TAVILY_API_KEY` in the application
   environment.
2. Construct the adapter once:

   ```ts
   const search = createTavilySearchAdapter({
     api_key: config.TAVILY_API_KEY,
   })
   ```

3. Call `searchVenues` or `searchEvents`. Inputs and successful Tavily payloads
   are Zod-validated; non-success responses are reduced to sanitized status
   metadata without trusting or surfacing their bodies. Both methods use an
   eight-second total deadline, one bounded retry for documented transient
   statuses, in-flight request coalescing, and a bounded success cache.

The adapter deliberately returns ranked web evidence. Tavily does not provide
authoritative structured venue addresses, prices, or event occurrence times,
so those fields must be extracted and verified in a later synthesis boundary
rather than invented here.

Searches always use Tavily's one-credit `basic` depth with automatic parameter
selection disabled. Venue evidence is cached for six hours and event evidence
for fifteen minutes to protect the free monthly credit allowance.

## Calendar identity and group isolation

`coordinateGroupAvailability` accepts a verified internal group ID and a
candidate interval. Its injected authorization dependency loads the complete,
current active-member snapshot; callers cannot supply or omit individual
members. Storage and Merge calls receive the snapshot's membership revision so
the integration can revalidate authorization immediately before personal
calendar access.

- A global `Person -> MergeIdentity` mapping allows one person to reuse a
  calendar connection across groups.
- Every request validates the complete authorized snapshot before any identity
  or calendar call starts. The snapshot is capped at 50 unique people.
- Public results contain only group-member IDs and normalized
  `free | busy | pending` evidence, the group ID, and membership revision.
  Merge IDs and raw calendar events never leave the tool boundary.
- Missing credentials, reconnect requirements, timeouts, and provider failures
  trigger same-group chat inference. Conclusive chat evidence may produce
  `free` or `busy`; an inconclusive fallback is `pending`, never silently
  `free`.
- The coordinator enforces a bounded total deadline and passes its cancellation
  signal into every dependency. Calendar reconnect and failure warnings remain
  visible even when chat supplies a definitive fallback.

The Orchestrator owns lifecycle transitions and the final confirmation guard.
It must read the authoritative current active-member set and decisions in one
transaction: every active member must have explicitly responded `yes`, every
member must be known free, any explicit `no` or busy result vetoes the
candidate, and missing or pending evidence blocks confirmation.

## Merge Agent Handler calendar adapter (`merge-calendar.ts`)

Implements the `resolveGlobalToolIdentity` / `queryCalendarAvailability`
dependencies `coordinateGroupAvailability` takes via DI:

```ts
const dependencies = createMergeAgentHandlerDependencies({
  access_key: config.MERGE_API_KEY,
  tool_pack_id: config.MERGE_TOOL_PACK_ID,
})
const coordinate = createGroupAvailabilityCoordinator({
  ...dependencies,
  resolveAuthorizedGroupSnapshot, // from /src/store
  inferChatAvailability, // from Phase 3 Claude reasoning
})
```

Two documented API disagreements/gaps this file handles defensively
(verified against live docs.merge.dev on 2026-07-25 — see git history for the
exact pages and quotes):

- The Registered User creation response's identifier field is named `id` in
  Merge's OpenAPI reference and `registered_user_id` in its prose guide.
  `extractRegisteredUserId` accepts either.
- Google Calendar's `query_freebusy` and Outlook's `get_user_schedule` /
  `find_meeting_times` are named in Merge's docs with no published
  input/output schema for any of them. This adapter never guesses a field
  name: it only sends arguments for fields a live `tools/list` call's
  `inputSchema` actually declares (see `buildCalendarToolArguments`), and
  only trusts one output shape it has real confidence in — Google's classic
  `{ calendars: { id: { busy: [...] } } }` freebusy shape, plus a flat
  `{ busy: [...] }` variant. Anything else — including any Outlook output
  today — safely resolves to `pending: upstream_error`, which
  `coordinateGroupAvailability` already turns into a same-group chat-text
  fallback rather than a fabricated availability.

`createMergeCalendarClient`'s returned function wires the real
`@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` (v1,
not the v2 beta `@modelcontextprotocol/client` package) against
`https://ah-api.merge.dev/api/v1/tool-packs/<TOOL_PACK_ID>/registered-users/<REGISTERED_USER_ID>/mcp/?authenticated_only=true`.
All decision logic (tool discovery, argument building, output parsing) is
factored into `queryCalendarAvailabilityViaClient`, unit-tested against a
`Pick<Client, 'listTools' | 'callTool'>`-typed fake rather than a
hand-mocked wire protocol — see the test file's top-of-file note for why.
Every outbound call (Registered User REST create, MCP connect) sets
`redirect: 'manual'` so a bearer token can never be forwarded to a
redirect-target host.
