// Compatibility exports for E2. These aliases deliberately point at the frozen Phase 1 contracts.
export { PlanSchema as planObjectSchema, type Plan as PlanObject } from './plan.js'
export {
  GroupProfileSchema as groupProfileSchema,
  PersonProfileSchema as personProfileSchema,
  type GroupProfile,
  type PersonProfile,
} from './profile.js'
export {
  TranscriptEntrySchema as transcriptEntrySchema,
  type TranscriptEntry,
} from './transcript.js'
