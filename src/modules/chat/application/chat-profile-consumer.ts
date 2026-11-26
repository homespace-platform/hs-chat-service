import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { ChatMessageBroadcaster } from './chat-message-broadcaster';

@Injectable()
export class ChatProfileConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatProfileConsumer.name);
  private readonly consumer;
  private readonly topic: string;
  private retry?: NodeJS.Timeout;
  private stopping = false;

  constructor(config: ConfigService, private readonly broadcaster: ChatMessageBroadcaster) {
    this.topic = config.getOrThrow<string>('KAFKA_CHAT_PROFILE_TOPIC');
    this.consumer = new Kafka({
      clientId: 'hs-chat-profile',
      brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(',').map((broker) => broker.trim()),
      logLevel: logLevel.NOTHING,
    }).consumer({ groupId: 'hs-chat-profile-v1', allowAutoTopicCreation: false });
  }

  onModuleInit() {
    void this.start();
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.retry);
    await this.consumer.disconnect();
  }

  private async start() {
    try {
      await this.consumer.connect();
      if (this.stopping) return;
      await this.consumer.subscribe({ topic: this.topic });
      if (this.stopping) return;
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          const userId = message.key?.toString();
          if (userId && userId.length <= 128 && message.value?.toString() === userId) {
            this.broadcaster.broadcastProfileChange(userId);
          }
        },
      });
    } catch {
      this.logger.warn('Chat profile consumer unavailable for ' + this.topic + ', retrying');
      if (!this.stopping) this.retry = setTimeout(() => void this.start(), 5_000);
    }
  }
}
