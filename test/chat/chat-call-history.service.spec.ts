import { jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChatCallHistoryService } from '../../src/modules/chat/application/chat-call-history.service';
import type { CallHistory } from '../../src/modules/chat/infrastructure/persistence/schemas/call-history.schema';

const key = {
  conversationId: '507f1f77bcf86cd799439011',
  callId: '123e4567-e89b-42d3-a456-426614174000',
};
const callerId = 'caller';
const calleeId = 'callee';
const query = <T>(read: () => T) => ({ exec: async () => read() });

describe('ChatCallHistoryService', () => {
  let record: CallHistory | undefined;
  let service: ChatCallHistoryService;
  const publishCall = jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const broadcastCallEnded = jest.fn();
  const calls = {
    exists: jest.fn(() => Promise.resolve(record ? { _id: record._id } : null)),
    findOneAndUpdate: jest.fn(
      (
        { _id }: { _id: string },
        { $setOnInsert }: { $setOnInsert: CallHistory },
      ) =>
        query(() => {
          const updatedExisting = Boolean(record);
          record ??= {
            ...$setOnInsert,
            _id,
            conversationId: new Types.ObjectId($setOnInsert.conversationId),
          };
          return { value: { ...record }, lastErrorObject: { updatedExisting } };
        }),
    ),
    findById: jest.fn((id: string) =>
      query(() => (record && record._id === id ? { ...record } : null)),
    ),
    find: jest.fn(({ pendingAt }: { pendingAt: { $lte: Date } }) =>
      query(() =>
        record?.pendingAt && record.pendingAt <= pendingAt.$lte
          ? [{ ...record }]
          : [],
      ),
    ),
    updateOne: jest.fn(
      (
        filter: {
          _id: string;
          status?: { $exists: false };
          calleeId?: string;
          deadlineAt?: { $gt: Date };
          acceptedAt?: Date | { $exists: false };
        },
        update: { $set?: Partial<CallHistory>; $unset?: { pendingAt: 1 } },
      ) =>
        query(() => {
          if (
            !record ||
            record._id !== filter._id ||
            (filter.status && record.status) ||
            (filter.calleeId && record.calleeId !== filter.calleeId) ||
            (filter.deadlineAt &&
              !(record.deadlineAt > filter.deadlineAt.$gt)) ||
            (filter.acceptedAt &&
              (filter.acceptedAt instanceof Date
                ? record.acceptedAt?.getTime() !== filter.acceptedAt.getTime()
                : record.acceptedAt))
          )
            return { matchedCount: 0 };
          Object.assign(record, update.$set);
          if (update.$unset) delete record.pendingAt;
          return { matchedCount: 1 };
        }),
    ),
  };
  const newService = () =>
    new ChatCallHistoryService(
      calls as never,
      { publishCall } as never,
      { broadcastCallEnded } as never,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-25T05:00:00.000Z') });
    jest.clearAllMocks();
    record = undefined;
    service = newService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('leaves legacy calls untracked and inserts a negotiated invite only once', async () => {
    expect(
      await service.invite(key, callerId, calleeId, 'audio', false),
    ).toEqual({ tracked: false, relay: true });
    expect(calls.findOneAndUpdate).not.toHaveBeenCalled();
    expect(await service.end(key, callerId)).toBe(false);
    expect(
      await service.invite(key, callerId, calleeId, 'audio', true),
    ).toEqual({ tracked: true, relay: true });
    expect(record?.deadlineAt.getTime()).toBe(Date.now() + 45_000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(
      await service.invite(key, callerId, calleeId, 'audio', true),
    ).toEqual({ tracked: true, relay: false });
    expect(record?.deadlineAt.getTime()).toBe(Date.now() + 44_000);
    await expect(
      service.invite(key, calleeId, callerId, 'audio', true),
    ).rejects.toThrow(ForbiddenException);
  });

  it('recovers a stored ringing deadline after restart and publishes a single missed call', async () => {
    await service.invite(key, callerId, calleeId, 'audio', true);
    const deadline = record?.deadlineAt;
    await jest.advanceTimersByTimeAsync(40_000);
    service = newService();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(4999);
    expect(publishCall).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(publishCall).toHaveBeenCalledWith(
      record?.messageId,
      record?.conversationId,
      calleeId,
      { callId: key.callId, callerId, mode: 'audio', status: 'missed' },
      deadline,
    );
    expect(broadcastCallEnded).toHaveBeenCalledWith(callerId, calleeId, key);
    expect(await service.end(key, callerId)).toBe(true);
    expect(publishCall).toHaveBeenCalledTimes(1);
    expect(broadcastCallEnded).toHaveBeenCalledTimes(1);
  });

  it('checks call participants and ignores a decline after acceptance', async () => {
    await service.invite(key, callerId, calleeId, 'video', true);
    await expect(service.accept(key, callerId)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.end(key, 'outsider')).rejects.toThrow(
      ForbiddenException,
    );
    await service.accept(key, calleeId);
    const acceptedAt = record?.acceptedAt;
    service = newService();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(46_000);
    await service.accept(key, calleeId);
    expect(record?.acceptedAt).toEqual(acceptedAt);
    await service.end(key, calleeId, 'declined');
    expect(publishCall).not.toHaveBeenCalled();
    await service.end(key, calleeId);
    expect(record?.status).toBe('ended');
  });

  it.each([
    [callerId, undefined, 'cancelled'],
    [calleeId, 'declined', 'declined'],
    [callerId, 'failed', 'failed'],
  ] as const)(
    'persists terminal outcomes for %s with %s',
    async (actor, reason, status) => {
      await service.invite(key, callerId, calleeId, 'audio', true);
      await Promise.all([
        service.end(key, actor, reason),
        service.end(key, actor, reason),
      ]);
      expect(record?.status).toBe(status);
      expect(publishCall).toHaveBeenCalledTimes(1);
      expect(broadcastCallEnded).toHaveBeenCalledTimes(1);
    },
  );

  it('retries a terminal message write after restart with the same message ID', async () => {
    await service.invite(key, callerId, calleeId, 'audio', true);
    publishCall.mockRejectedValueOnce(new Error('message write interrupted'));
    await expect(service.end(key, callerId)).rejects.toThrow(
      'message write interrupted',
    );
    expect(broadcastCallEnded).not.toHaveBeenCalled();
    service = newService();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(publishCall).toHaveBeenCalledTimes(2);
    expect(publishCall.mock.calls[0]).toEqual(publishCall.mock.calls[1]);
    expect(broadcastCallEnded).toHaveBeenCalledTimes(1);
  });
});
