import { z } from 'zod';

export const planStatusSchema = z.enum(['proposed', 'revising', 'confirmed', 'abandoned']);
export const costTierSchema = z.enum(['free', 'low', 'medium', 'high']);
export const attendanceSchema = z.enum(['yes', 'no', 'pending']);

export const venueSchema = z.object({
  name: z.string().min(1),
  source_tool: z.string().min(1),
  ref_id: z.string().min(1),
});

export const planObjectSchema = z.object({
  plan_id: z.uuid(),
  version: z.number().int().positive(),
  status: planStatusSchema,
  activity: z.string().min(1),
  venue: venueSchema,
  datetime: z.iso.datetime({ offset: true }),
  cost_tier: costTierSchema,
  attendees: z.record(z.string().min(1), attendanceSchema),
  rationale: z.string().min(1),
});

export const profileSignalSchema = z.object({
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
  mentions: z.number().int().positive(),
  observedAt: z.iso.datetime({ offset: true }),
});

export const personProfileSchema = z.object({
  groupId: z.string().min(1),
  personId: z.string().min(1),
  interests: z.array(profileSignalSchema).default([]),
  budgetSignals: z.array(profileSignalSchema).default([]),
  constraints: z.array(profileSignalSchema).default([]),
  availability: z.array(profileSignalSchema).default([]),
});

export const groupProfileSchema = z.object({
  groupId: z.string().min(1),
  sharedInterests: z.array(profileSignalSchema).default([]),
  runningJokes: z.array(profileSignalSchema).default([]),
  initiators: z.array(profileSignalSchema).default([]),
  pastHangoutSentiment: z.array(profileSignalSchema).default([]),
});

export const transcriptEntrySchema = z.object({
  groupId: z.string().min(1),
  senderId: z.string().min(1),
  text: z.string().min(1),
  sentAt: z.iso.datetime({ offset: true }),
});

export type PlanObject = z.infer<typeof planObjectSchema>;
export type PersonProfile = z.infer<typeof personProfileSchema>;
export type GroupProfile = z.infer<typeof groupProfileSchema>;
export type ProfileSignal = z.infer<typeof profileSignalSchema>;
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;
