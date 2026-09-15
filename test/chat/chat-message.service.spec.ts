import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ChatMessageService } from '../../src/modules/chat/application/chat-message.service';

function queryReturning<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('ChatMessageService', () => {
  const messageModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const conversationModel = {
    updateOne: jest.fn(),
  };
  const conversationService = {
    getParticipantOrThrow: jest.fn(),
    toView: jest.fn((conversation, userId) => ({
      id: conversation._id.toString(),
      participantId: conversation.participantIds.find((id) => id !== userId),
      unreadCount: conversation.unreadCounts?.[userId] ?? 0,
    })),
  };
  let service: ChatMessageService;

  beforeEach(() => {
    jest.clearAllMocks();
    conversationService.getParticipantOrThrow.mockResolvedValue({
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      unreadCounts: { 'user-a': 0, 'user-b': 0 },
    });
    messageModel.create.mockResolvedValue({
      _id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      content: 'Chào bạn',
      createdAt: new Date('2026-09-03T10:00:00.000Z'),
    });
    conversationModel.updateOne.mockReturnValue(
      queryReturning({ acknowledged: true }),
    );
    messageModel.updateOne.mockReturnValue(queryReturning({ matchedCount: 1 }));
    service = new ChatMessageService(
      messageModel as never,
      conversationModel as never,
      conversationService as never,
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
      { _id: 'conversation-id', participantIds: 'user-a' },
      expect.objectContaining({ $inc: { 'unreadCounts.user-b': 1 } }),
    );
    expect(result.senderId).toBe('user-a');
  });

  it('stores the sender profile so the recipient can render the conversation identity', async () => {
    await service.sendMessage('user-a', 'conversation-id', {
      content: 'Xin chào',
      senderProfile: {
        displayName: 'Người thuê A',
        avatarUrl: 'https://example.com/tenant.jpg',
      },
    });

    expect(conversationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'conversation-id', participantIds: 'user-a' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'participantProfiles.user-a': {
            displayName: 'Người thuê A',
            avatarUrl: 'https://example.com/tenant.jpg',
          },
        }),
      }),
    );
  });

  it('rejects empty content and blocks non-participants', async () => {
    await expect(
      service.sendMessage('user-a', 'conversation-id', { content: '  ' }),
    ).rejects.toThrow();

    conversationService.getParticipantOrThrow.mockRejectedValueOnce(
      new NotFoundException(),
    );
    await expect(
      service.listMessages('user-c', 'conversation-id', {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('resets only the current user unread count', async () => {
    const result = await service.markRead('user-a', 'conversation-id');

    expect(conversationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'conversation-id', participantIds: 'user-a' },
      { $set: { 'unreadCounts.user-a': 0 } },
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
      { new: true },
    );
  });
});
