import {
  Conversation,
  ConversationSchema,
} from '../../src/modules/chat/infrastructure/persistence/schemas/conversation.schema';
import {
  Message,
  MessageSchema,
} from '../../src/modules/chat/infrastructure/persistence/schemas/message.schema';

describe('chat schemas', () => {
  it('uses a unique participant/listing index', () => {
    expect(ConversationSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ participantKey: 1, listingId: 1 }, { unique: true }],
      ]),
    );
  });

  it('indexes messages by conversation and creation time', () => {
    expect(MessageSchema.indexes()).toEqual(
      expect.arrayContaining([[{ conversationId: 1, createdAt: 1 }, {}]]),
    );
  });

  it('exposes stable model names', () => {
    expect(Conversation.name).toBe('Conversation');
    expect(Message.name).toBe('Message');
  });
});
