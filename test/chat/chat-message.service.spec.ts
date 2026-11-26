import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Types } from 'mongoose';
import { ChatMessageService } from '../../src/modules/chat/application/chat-message.service';
type TestConversation = {
  _id: string;
  participantIds: string[];
  unreadCounts?: Record<string, number>;
  participantRoles?: Record<string, string>;
};

function queryReturning<T>(value: T) {
  return { exec: jest.fn(async () => value) };
}

describe('ChatMessageService', () => {
  const messageModel = {
    create: jest.fn<(input: Record<string, unknown>) => Promise<object>>(),
    exists: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const conversationModel = {
    findOne: jest.fn(),
    updateOne: jest.fn(),
  };
  const conversationService = {
    getParticipantOrThrow: jest.fn<() => Promise<TestConversation>>(),
    toView: jest.fn((conversation: TestConversation, userId: string) => ({
      id: conversation._id.toString(),
      participantId: conversation.participantIds.find((id) => id !== userId),
      unreadCount: conversation.unreadCounts?.[userId] ?? 0,
    })),
  };
  let service: ChatMessageService;
  const media = {
    resolveAttachments: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  };
  const broadcaster = { broadcast: jest.fn() };
  const notificationPublisher = { wake: jest.fn() };
  const messageId = new Types.ObjectId();

  function previewUpdate() {
    const pipeline = conversationModel.updateOne.mock.calls.at(-1)?.[1] as [
      { $set: Record<string, unknown> },
    ];
    return pipeline[0].$set;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    media.resolveAttachments.mockResolvedValue([]);
    conversationService.getParticipantOrThrow.mockResolvedValue({
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      unreadCounts: { 'user-a': 0, 'user-b': 0 },
    });
    messageModel.create.mockImplementation(async (input) => {
      const message = {
        ...input,
        _id: messageId,
        conversationId: 'conversation-id',
        createdAt: new Date('2026-09-03T10:00:00.000Z'),
      };
      messageModel.findOneAndUpdate.mockReturnValue(queryReturning(message));
      return message;
    });
    messageModel.findOneAndUpdate.mockReturnValue(queryReturning(null));
    messageModel.exists.mockReturnValue(queryReturning({ _id: messageId }));
    conversationModel.updateOne.mockReturnValue(
      queryReturning({ matchedCount: 1 }),
    );
    messageModel.updateOne.mockReturnValue(queryReturning({ matchedCount: 1 }));
    service = new ChatMessageService(
      messageModel as never,
      conversationModel as never,
      conversationService as never,
      media as never,
      broadcaster as never,
      notificationPublisher as never,
    );
  });

  it('stores the gateway user as sender and updates the conversation preview', async () => {
    const result = await service.sendMessage('user-a', 'conversation-id', {
      content: '  Chào bạn  ',
    });

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: 'user-a', content: 'Chào bạn' }),
    );
    expect(conversationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'conversation-id', participantIds: { $all: ['user-a', 'user-b'] }, lastAppliedMessageId: null },
      expect.any(Array),
      { updatePipeline: true, timestamps: false },
    );
    expect(previewUpdate()).toHaveProperty(['unreadCounts.user-b', '$add']);
    expect(previewUpdate().lastMessage).toEqual({
      $cond: [expect.any(Object), { $literal: 'Chào bạn' }, '$lastMessage'],
    });
    expect(result.senderId).toBe('user-a');
    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingNotificationRecipientId: 'user-b',
      }),
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      result,
      'user-a',
      'user-b',
    );
    expect(notificationPublisher.wake).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('pendingNotificationRecipientId');
  });

  it('acknowledges the saved message and leaves the conversation update available for recovery', async () => {
    conversationModel.updateOne.mockReturnValueOnce({
      exec: jest.fn(async () => {
        throw new Error('update failed');
      }),
    });
    const message = await service.sendMessage('user-a', 'conversation-id', { content: 'hello' });
    expect(message.id).toBe(messageId.toString());
    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingNotificationRecipientId: 'user-b',
        pendingConversationUpdate: expect.objectContaining({ recipientId: 'user-b', preview: 'hello' }),
      }),
    );
    expect(messageModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(notificationPublisher.wake).not.toHaveBeenCalled();
  });

  it('finishes an already applied update without incrementing the unread count again', async () => {
    conversationModel.updateOne.mockReturnValueOnce(queryReturning({ matchedCount: 0 }));
    conversationModel.findOne.mockReturnValue(queryReturning({ lastAppliedMessageId: messageId }));

    await service.sendMessage('user-a', 'conversation-id', { content: 'hello' });

    expect(conversationModel.updateOne).toHaveBeenCalledTimes(1);
    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: messageId, conversationId: 'conversation-id', pendingConversationUpdate: { $exists: true } },
      { $unset: { pendingConversationUpdate: 1 } },
      { returnDocument: 'before' },
    );
  });

  it('uses validated attachment metadata and refuses attachments before writing messages', async () => {
    const canonical = {
      storageId: 'chat_uuid',
      fileName: 'real.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 100,
    };
    media.resolveAttachments.mockResolvedValue([canonical]);
    await service.sendMessage('user-a', 'conversation-id', {
      attachments: [{ ...canonical, fileName: 'forged.jpg' }],
    });
    expect(media.resolveAttachments).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
      [expect.objectContaining({ fileName: 'forged.jpg' })],
    );
    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: '', attachments: [canonical] }),
    );
    expect(previewUpdate().lastMessage).toEqual({
      $cond: [expect.any(Object), { $literal: 'real.jpg' }, '$lastMessage'],
    });
    messageModel.create.mockClear();
    media.resolveAttachments.mockRejectedValue(
      new Error('attachment forbidden'),
    );
    await expect(
      service.sendMessage('user-a', 'conversation-id', {
        content: '',
        attachments: [canonical],
      }),
    ).rejects.toThrow('attachment forbidden');
    expect(messageModel.create).not.toHaveBeenCalled();
  });

  it('upserts call history with a stable message ID and broadcasts the standard view', async () => {
    const call = {
      callId: 'call-id',
      callerId: 'user-a',
      mode: 'audio',
      status: 'missed',
    } as const;
    const createdAt = new Date('2026-11-25T05:00:45.000Z');
    const row = {
      _id: 'call-message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      content: 'Cuộc gọi nhỡ',
      call,
      createdAt,
    };
    messageModel.findOneAndUpdate.mockReturnValue(queryReturning(row));
    await service.publishCall(row._id as never, row.conversationId as never, 'user-b', call, createdAt);
    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: row._id },
      { $setOnInsert: expect.objectContaining({ call, createdAt }) },
      expect.objectContaining({ upsert: true, overwriteImmutable: true }),
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ id: row._id, content: row.content, call }),
      'user-a',
      'user-b',
    );
  });

  it('stores the sender profile so the recipient can render the conversation identity', async () => {
    await service.sendMessage('user-a', 'conversation-id', {
      content: 'Xin chào',
      senderProfile: {
        displayName: 'Người thuê A',
        avatarUrl: 'https://example.com/tenant.jpg',
      },
    });

    expect(previewUpdate()['participantProfiles.user-a']).toEqual({
      $literal: {
        displayName: 'Người thuê A',
        avatarUrl: 'https://example.com/tenant.jpg',
      },
    });
  });

  it('seeds roles from the first listing message and never overwrites them', async () => {
    const listing = {
      id: 'listing-id',
      title: 'Nhà',
      price: '14.000.000 ₫',
      location: 'Gò Vấp',
      image: '',
    };
    await service.sendMessage('user-a', 'conversation-id', { content: 'hi' });
    expect(previewUpdate()).not.toHaveProperty(['participantRoles.user-a']);

    await service.sendMessage('user-a', 'conversation-id', {
      content: 'hi',
      listing,
    });
    const noRoles = {
      $and: [
        { $eq: [{ $ifNull: ['$participantRoles.user-a', null] }, null] },
        { $eq: [{ $ifNull: ['$participantRoles.user-b', null] }, null] },
      ],
    };
    expect(previewUpdate()).toMatchObject({
      'participantRoles.user-a': { $cond: [noRoles, 'TENANT', '$participantRoles.user-a'] },
      'participantRoles.user-b': { $cond: [noRoles, 'LANDLORD', '$participantRoles.user-b'] },
    });
  });

  it('rejects empty content and blocks non-participants', async () => {
    await expect(
      service.sendMessage('user-a', 'conversation-id', { content: '  ' }),
    ).rejects.toThrow();

    conversationService.getParticipantOrThrow.mockRejectedValueOnce(
      new NotFoundException(),
    );
    await expect(
      service.listMessages('user-c', 'conversation-id', { limit: 50 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('filters visible messages by literal text or image within the participant conversation', async () => {
    const rows = [
      {
        _id: 'message-id',
        conversationId: 'conversation-id',
        senderId: 'user-a',
        content: 'photo',
        attachments: [],
        createdAt: new Date('2026-09-03T10:00:00.000Z'),
      },
    ];
    const exec = jest.fn(async () => rows);
    const limit = jest.fn(() => ({ exec }));
    const sort = jest.fn(() => ({ limit }));
    messageModel.find.mockReturnValue({ sort });

    await service.listMessages('user-a', 'conversation-id', {
      limit: 20,
      search: 'a+b',
    });
    expect(messageModel.find).toHaveBeenCalledWith({
      conversationId: 'conversation-id',
      hiddenFor: { $ne: 'user-a' },
      content: { $regex: 'a\\+b', $options: 'i' },
    });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(limit).toHaveBeenCalledWith(21);

    await service.listMessages('user-a', 'conversation-id', {
      limit: 20,
      media: 'images',
    });
    expect(messageModel.find).toHaveBeenLastCalledWith({
      conversationId: 'conversation-id',
      hiddenFor: { $ne: 'user-a' },
      'attachments.contentType': /^image\//,
    });
  });

  it('resets only the current user unread count', async () => {
    const result = await service.markRead('user-a', 'conversation-id');

    expect(conversationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'conversation-id', participantIds: 'user-a' },
      {
        $set: { 'unreadCounts.user-a': 0 },
        $currentDate: { 'lastReadAt.user-a': true },
      },
    );
    expect(result.unreadCount).toBe(0);
  });

  it('pins per user, deletes only for that user, and recalls only sent messages', async () => {
    messageModel.findOneAndUpdate
      .mockReturnValueOnce(
        queryReturning({
          _id: 'message-id',
          conversationId: 'conversation-id',
          senderId: 'user-a',
          content: 'Chào bạn',
          attachments: [],
          pinnedBy: ['user-a'],
          createdAt: new Date('2026-09-03T10:00:00.000Z'),
        }),
      )
      .mockReturnValueOnce(
        queryReturning({
          _id: 'message-id',
          conversationId: 'conversation-id',
          senderId: 'user-a',
          content: 'Tin nhắn đã được thu hồi',
          attachments: [],
          pinnedBy: [],
          recalledAt: new Date('2026-09-03T10:01:00.000Z'),
          createdAt: new Date('2026-09-03T10:00:00.000Z'),
        }),
      );

    const pinned = await service.setPinned(
      'user-a',
      'conversation-id',
      'message-id',
      true,
    );
    await service.deleteForUser('user-a', 'conversation-id', 'message-id');
    const recalled = await service.recall(
      'user-a',
      'conversation-id',
      'message-id',
    );

    expect(pinned.isPinned).toBe(true);
    expect(messageModel.updateOne).toHaveBeenCalledWith(
      { _id: 'message-id', conversationId: 'conversation-id' },
      {
        $addToSet: { hiddenFor: 'user-a' },
        $pull: { pinnedBy: 'user-a' },
      },
    );
    expect(recalled.message.isRecalled).toBe(true);
    expect(recalled.message.content).toBe('Tin nhắn đã được thu hồi');
    expect(messageModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        senderId: 'user-a',
        createdAt: { $gte: expect.any(Date) },
      }),
      expect.anything(),
      { returnDocument: 'after' },
    );
  });
});
