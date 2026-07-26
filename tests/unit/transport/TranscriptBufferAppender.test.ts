import { describe, expect, it, vi } from 'vitest'

import { InMemoryTransportPort } from '../../../src/transport/InMemoryTransportPort.js'
import { TranscriptBufferAppender } from '../../../src/transport/TranscriptBufferAppender.js'

describe('TranscriptBufferAppender', () => {
  it('appends each inbound message to the repository with group and sender metadata', async () => {
    const transport = new InMemoryTransportPort()
    const append = vi.fn().mockResolvedValue(undefined)

    const appender = new TranscriptBufferAppender({
      transport,
      repository: { append },
    })

    appender.start()

    await transport.emitMessage({
      messageId: 'm-1',
      groupId: 'group-a',
      senderId: 'sam',
      text: 'we should hang out',
      receivedAt: new Date('2026-07-25T12:00:00.000Z'),
    })

    expect(append).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledWith({
      groupId: 'group-a',
      senderId: 'sam',
      text: 'we should hang out',
      receivedAt: new Date('2026-07-25T12:00:00.000Z'),
    })
  })

  it('stops appending once stopped', async () => {
    const transport = new InMemoryTransportPort()
    const append = vi.fn().mockResolvedValue(undefined)

    const appender = new TranscriptBufferAppender({
      transport,
      repository: { append },
    })

    appender.start()
    appender.stop()

    await transport.emitMessage({
      messageId: 'm-2',
      groupId: 'group-a',
      senderId: 'jess',
      text: 'Saturday works',
      receivedAt: new Date('2026-07-25T12:05:00.000Z'),
    })

    expect(append).not.toHaveBeenCalled()
  })

  it('does not double-subscribe when start is called twice', async () => {
    const transport = new InMemoryTransportPort()
    const append = vi.fn().mockResolvedValue(undefined)

    const appender = new TranscriptBufferAppender({
      transport,
      repository: { append },
    })

    appender.start()
    appender.start()

    await transport.emitMessage({
      messageId: 'm-3',
      groupId: 'group-a',
      senderId: 'alex',
      text: "let's do dinner",
      receivedAt: new Date('2026-07-25T12:07:00.000Z'),
    })

    expect(append).toHaveBeenCalledTimes(1)
  })
})
