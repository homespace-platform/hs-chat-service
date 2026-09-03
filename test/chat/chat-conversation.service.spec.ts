import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ChatConversationService } from '../../src/modules/chat/application/chat-conversation.service';
import { DIRECT_CONVERSATION_LISTING_ID } from '../../src/modules/chat/application/conversation-key';

function queryReturning<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('ChatConversationService', () => {
  const conversationModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
  };
  let service: ChatConversationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatConversationService(conversationModel as never);
  });

  it('creates a conversation with sorted participants and a direct listing sentinel', async () => {
    conversationModel.findOne.mockReturnValueOnce(queryReturning(null));
    conversationModel.create.mockResolvedValueOnce({
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      listingId: DIRECT_CONVERSATION_LISTING_ID,
      unreadCounts: { 'user-a': 0, 'user-b': 0 },
    });

    await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
    });

    expect(conversationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        participantIds: ['user-a', 'user-b'],
        participantKey: 'user-a:user-b',
        listingId: DIRECT_CONVERSATION_LISTING_ID,
      }),
    );
  });

  it('returns an existing conversation instead of creating a duplicate', async () => {
    const existingConversation = {
      _id: 'conversation-id',
      participantIds: ['user-a', 'user-b'],
      listingId: DIRECT_CONVERSATION_LISTING_ID,
      unreadCounts: { 'user-a': 0, 'user-b': 2 },
      lastMessage: 'Xin chào',
    };
    conversationModel.findOne.mockReturnValueOnce(
      queryReturning(existingConversation),
    );

    const result = await service.createOrReuseConversation('user-a', {
      participantId: 'user-b',
    });

    expect(conversationModel.create).not.toHaveBeenCalled();
    expect(result.id).toBe('conversation-id');
    expect(result.unreadCount).toBe(0);
  });

  it('rejects self-chat and hides a conversation from non-participants', async () => {
    await expect(
      service.createOrReuseConversation('user-a', { participantId: 'user-a' }),
    ).rejects.toThrow();

    conversationModel.findOne.mockReturnValueOnce(queryReturning(null));
    await expect(
      service.getParticipantOrThrow('conversation-id', 'user-c'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns not found for an invalid Mongo conversation id', async () => {
    await expect(
      service.getParticipantOrThrow('not-an-object-id', 'user-a'),
    ).rejects.toThrow(NotFoundException);
    expect(conversationModel.findOne).not.toHaveBeenCalled();
  });
});
