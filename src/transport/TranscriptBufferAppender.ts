import type {
  TransportInboundMessage,
  TransportPort,
  Unsubscribe,
} from "./TransportPort.js";

export interface TranscriptAppendInput {
  groupId: string;
  senderId: string;
  text: string;
  receivedAt: Date;
}

export interface TranscriptBufferRepository {
  append(input: TranscriptAppendInput): Promise<void>;
}

export interface TranscriptBufferAppenderOptions {
  transport: TransportPort;
  repository: TranscriptBufferRepository;
}

export class TranscriptBufferAppender {
  private readonly transport: TransportPort;
  private readonly repository: TranscriptBufferRepository;
  private unsubscribe: Unsubscribe | undefined;

  constructor(options: TranscriptBufferAppenderOptions) {
    this.transport = options.transport;
    this.repository = options.repository;
  }

  start(): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.transport.onMessage(async (message) => {
      await this.appendMessage(message);
    });
  }

  stop(): void {
    if (!this.unsubscribe) {
      return;
    }

    this.unsubscribe();
    this.unsubscribe = undefined;
  }

  private async appendMessage(message: TransportInboundMessage): Promise<void> {
    await this.repository.append({
      groupId: message.groupId,
      senderId: message.senderId,
      text: message.text,
      receivedAt: message.receivedAt,
    });
  }
}
