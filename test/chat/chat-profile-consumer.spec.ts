import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { EachMessagePayload } from 'kafkajs';
import { ChatProfileConsumer } from '../../src/modules/chat/application/chat-profile-consumer';

it('relays only valid profile signals from the provisioned topic', async () => {
  const broadcastProfileChange = jest.fn();
  const consumer = new ChatProfileConsumer(
    new ConfigService({
      KAFKA_BROKERS: 'localhost:9092',
      KAFKA_CHAT_PROFILE_TOPIC: 'homespace.user.chat-profile.test',
    }),
    { broadcastProfileChange } as never,
  );
  const kafka = {
    connect: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    run: jest.fn(async ({ eachMessage }: {
      eachMessage: (payload: EachMessagePayload) => Promise<void>;
    }) => {
      for (const value of ['user-b', 'user-a']) {
        await eachMessage({
          message: { key: Buffer.from('user-a'), value: Buffer.from(value) },
        } as EachMessagePayload);
      }
    }),
  };
  Object.assign(consumer, { consumer: kafka });

  consumer.onModuleInit();
  await new Promise<void>(setImmediate);
  await consumer.onModuleDestroy();

  expect(kafka.subscribe).toHaveBeenCalledWith({ topic: 'homespace.user.chat-profile.test' });
  expect(broadcastProfileChange).toHaveBeenCalledTimes(1);
  expect(broadcastProfileChange).toHaveBeenCalledWith('user-a');
  expect(kafka.disconnect).toHaveBeenCalledTimes(1);
});
