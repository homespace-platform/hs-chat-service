import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Kafka } from 'kafkajs';
import type { Model } from 'mongoose';
import { Message } from '../infrastructure/persistence/schemas/message.schema';

const TOPIC = 'homespace.notification.events.v1';
const RETRY_INTERVAL_MS = 5_000;

@Injectable()
export class ChatNotificationPublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChatNotificationPublisher.name);
  private readonly producer;
  private timer?: NodeJS.Timeout;
  private connected = false;
  private publishing = false;
  private wakeRequested = false;
  private nextWakeAt = 0;

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    config: ConfigService,
  ) {
    this.producer = new Kafka({
      clientId: 'hs-chat-service',
      brokers: (config.get<string>('KAFKA_BROKERS') || 'localhost:9092')
        .split(',')
        .map((broker) => broker.trim()),
    }).producer();
  }

  onModuleInit() {
    this.timer = setInterval(
      () => void this.publishPending(),
      RETRY_INTERVAL_MS,
    );
    void this.publishPending();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.connected) await this.producer.disconnect();
  }

  wake() {
    if (Date.now() < this.nextWakeAt) return;
    if (this.publishing) {
      this.wakeRequested = true;
      return;
    }
    setImmediate(() => {
      if (Date.now() >= this.nextWakeAt) void this.publishPending();
    });
  }

  async publishPending() {
    if (this.publishing) return;
    this.publishing = true;
    try {
      for (let i = 0; i < 100; i++) {
        const claimUntil = new Date(Date.now() + 60_000);
        const message = await this.messageModel
          .findOneAndUpdate(
            {
              pendingNotificationRecipientId: { $exists: true },
              notificationPublishedAt: { $exists: false },
              $or: [
                { notificationClaimedUntil: { $exists: false } },
                { notificationClaimedUntil: { $lte: new Date() } },
              ],
            },
            { $set: { notificationClaimedUntil: claimUntil } },
            { sort: { createdAt: 1 }, returnDocument: 'after' },
          )
          .exec();
        if (!message) break;

        try {
          if (!this.connected) {
            await this.producer.connect();
            this.connected = true;
          }
          const messageId = message._id.toString();
          const eventId = `chat_${messageId}`;
          await this.producer.send({
            topic: TOPIC,
            messages: [
              {
                key: eventId,
                value: JSON.stringify({
                  eventId,
                  eventType: 'CHAT_ALERT_REQUESTED',
                  version: 1,
                  occurredAt: message.createdAt.toISOString(),
                  recipients: [message.pendingNotificationRecipientId],
                  data: {
                    conversationId: message.conversationId.toString(),
                    messageId,
                  },
                }),
              },
            ],
          });
          await this.messageModel
            .updateOne(
              { _id: message._id, notificationClaimedUntil: claimUntil },
              {
                $set: { notificationPublishedAt: new Date() },
                $unset: { notificationClaimedUntil: 1 },
              },
            )
            .exec();
        } catch (error) {
          this.nextWakeAt = Date.now() + RETRY_INTERVAL_MS;
          this.logger.warn(
            `Chat notification publish failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          await this.messageModel
            .updateOne(
              { _id: message._id, notificationClaimedUntil: claimUntil },
              { $unset: { notificationClaimedUntil: 1 } },
            )
            .exec();
          break;
        }
      }
    } catch (error) {
      this.nextWakeAt = Date.now() + RETRY_INTERVAL_MS;
      this.logger.warn(
        `Chat notification scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.publishing = false;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        this.wake();
      }
    }
  }
}
