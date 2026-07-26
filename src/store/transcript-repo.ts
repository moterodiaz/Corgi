import { prisma } from './client.js'
import { TranscriptEntrySchema, type TranscriptEntry } from '../types/transcript.js'

export async function appendTranscriptEntry(entry: TranscriptEntry): Promise<void> {
  await prisma.transcriptBuffer.create({
    data: {
      groupId: entry.groupId,
      sender: entry.sender,
      text: entry.text,
      timestamp: entry.timestamp,
    },
  })
}

// Returns entries for a group in ascending chronological order.
// limit defaults to 200 — enough for context extraction without unbounded growth.
// ponytail: linear scan, add cursor-based pagination if group transcripts exceed ~10k rows
export async function getTranscriptByGroup(
  groupId: string,
  limit = 200,
): Promise<TranscriptEntry[]> {
  const rows = await prisma.transcriptBuffer.findMany({
    where: { groupId },
    orderBy: { timestamp: 'asc' },
    take: limit,
  })
  return rows.map((row) =>
    TranscriptEntrySchema.parse({
      groupId: row.groupId,
      sender: row.sender,
      text: row.text,
      timestamp: row.timestamp,
    }),
  )
}
