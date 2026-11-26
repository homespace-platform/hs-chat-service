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

  it('allows empty message text only with valid attachment metadata', async () => {
    const MessageModel = model('MessageValidation', MessageSchema);
    const input = { conversationId: new Types.ObjectId(), senderId: 'a', content: '' };
    await expect(new MessageModel(input).validate()).rejects.toHaveProperty('errors.content');
    await expect(new MessageModel({
      ...input,
      attachments: [{
        storageId: 'chat_file',
        fileName: 'slides.pptx',
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sizeBytes: 100,
      }],
    }).validate()).resolves.toBeUndefined();
  });
});
import { model, Types } from 'mongoose';
