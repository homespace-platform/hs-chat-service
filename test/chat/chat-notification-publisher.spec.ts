import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ChatNotificationPublisher } from '../../src/modules/chat/application/chat-notification-publisher';

describe('ChatNotificationPublisher', () => {
  it('wakes asynchronously without waiting for publication', async () => {
    const publisher = new ChatNotificationPublisher(
      {} as never,
      { get: () => 'localhost:9092' } as never,
    );
    const publish = jest
      .spyOn(publisher, 'publishPending')
      .mockResolvedValue(undefined);

    publisher.wake();
    expect(publish).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('runs a queued wake after an active scan', async () => {
    let finishScan!: (value: null) => void;
    const firstScan = new Promise<null>((resolve) => {
      finishScan = resolve;
    });
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValueOnce({ exec: () => firstScan })
      .mockReturnValueOnce({ exec: async () => null });
    const publisher = new ChatNotificationPublisher(
      { findOneAndUpdate } as never,
      { get: () => 'localhost:9092' } as never,
    );

    const running = publisher.publishPending();
    publisher.wake();
    finishScan(null);
    await running;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('publishes the exact v1 alert from a persisted message and marks it sent', async () => {
    const message = {
      _id: 'message-1',
      conversationId: 'conversation-1',
      pendingNotificationRecipientId: 'user-b',
      content: 'private content',
      createdAt: new Date('2026-11-15T00:00:00.000Z'),
    };
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValueOnce({ exec: jest.fn(async () => message) })
      .mockReturnValueOnce({ exec: jest.fn(async () => null) });
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn(async () => ({})) });
    const publisher = new ChatNotificationPublisher(
      { findOneAndUpdate, updateOne } as never,
      { get: () => 'localhost:9092' } as never,
    );
    const send = jest.fn(async () => ({}));
    Object.assign(publisher, {
      producer: {
        connect: jest.fn(async () => {}),
        send,
        disconnect: jest.fn(async () => {}),
      },
    });

    await publisher.publishPending();

    expect(findOneAndUpdate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        pendingNotificationRecipientId: { $exists: true },
        notificationPublishedAt: { $exists: false },
      }),
    );
    expect(send).toHaveBeenCalledWith({
      topic: 'homespace.notification.events.v1',
      messages: [
        {
          key: 'chat_message-1',
          value: JSON.stringify({
            eventId: 'chat_message-1',
            eventType: 'CHAT_ALERT_REQUESTED',
            version: 1,
            occurredAt: '2026-11-15T00:00:00.000Z',
            recipients: ['user-b'],
            data: { conversationId: 'conversation-1', messageId: 'message-1' },
          }),
        },
      ],
    });
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'message-1' }),
      expect.objectContaining({
        $set: { notificationPublishedAt: expect.any(Date) },
      }),
    );
  });

  it('keeps a failed publish retryable', async () => {
    const message = {
      _id: 'message-1',
      conversationId: 'conversation-1',
      pendingNotificationRecipientId: 'user-b',
      createdAt: new Date(),
    };
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn(async () => ({})) });
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValue({ exec: jest.fn(async () => message) });
    const publisher = new ChatNotificationPublisher(
      {
        findOneAndUpdate,
        updateOne,
      } as never,
      { get: () => 'localhost:9092' } as never,
    );
    Object.assign(publisher, {
      producer: {
        connect: jest.fn(async () => {
          throw new Error('broker down');
        }),
      },
    });

    const running = publisher.publishPending();
    publisher.wake();
    await running;
    publisher.wake();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'message-1' }),
      { $unset: { notificationClaimedUntil: 1 } },
    );
    await publisher.publishPending();
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});
