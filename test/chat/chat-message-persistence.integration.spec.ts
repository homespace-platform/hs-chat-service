import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { createConnection, Types, type Connection, type Model } from 'mongoose';
import { ChatConversationService } from '../../src/modules/chat/application/chat-conversation.service';
import { ChatMessageService } from '../../src/modules/chat/application/chat-message.service';
import {
  Conversation,
  ConversationSchema,
} from '../../src/modules/chat/infrastructure/persistence/schemas/conversation.schema';
import {
  Message,
  MessageSchema,
} from '../../src/modules/chat/infrastructure/persistence/schemas/message.schema';

const port = process.env.HS_CHAT_TEST_MONGO_PORT;
const describeMongo = port ? describe : describe.skip;

describeMongo('chat message persistence on standalone MongoDB', () => {
  let connection: Connection;
  let messages: Model<Message>;
  let conversations: Model<Conversation>;
  let service: ChatMessageService;
  let conversationId: string;
  const broadcast = jest.fn();

  beforeAll(async () => {
    connection = await createConnection('mongodb://127.0.0.1:' + port, {
      dbName: 'hs_chat_test_' + randomUUID().replaceAll('-', ''),
      serverSelectionTimeoutMS: 3_000,
    }).asPromise();
    messages = connection.model(Message.name, MessageSchema);
    conversations = connection.model(Conversation.name, ConversationSchema);
    await Promise.all([messages.init(), conversations.init()]);
  });

  beforeEach(async () => {
    broadcast.mockClear();
    const conversation = await conversations.create({
      participantIds: ['sender', 'recipient'],
      participantKey: randomUUID(),
    });
    conversationId = conversation.id as string;
    service = new ChatMessageService(
      messages,
      conversations,
      new ChatConversationService(conversations),
      { resolveAttachments: async () => [] } as never,
      { broadcast } as never,
      { wake: jest.fn() } as never,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.dropDatabase();
    await connection.close();
  });

  const failWrite = () =>
    ({
      exec: async () => {
        throw new Error('simulated database write failure');
      },
    }) as never;

  async function waitForRecovery() {
    service.onModuleInit();
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        !(await messages.exists({
          conversationId: new Types.ObjectId(conversationId),
          pendingConversationUpdate: { $exists: true },
        }))
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Conversation update was not recovered');
  }

  it('keeps the newer preview and counts both messages when an older write is recovered', async () => {
    jest.spyOn(conversations, 'updateOne').mockImplementationOnce(failWrite);
    const older = await service.sendMessage('sender', conversationId, {
      content: 'older',
    });
    expect(broadcast).not.toHaveBeenCalled();
    expect(await messages.countDocuments({ _id: older.id })).toBe(1);
    expect(
      await messages.exists({
        _id: older.id,
        pendingConversationUpdate: { $exists: true },
      }),
    ).toBeTruthy();

    const newer = await service.sendMessage('sender', conversationId, {
      content: '$newer',
    });
    await waitForRecovery();

    const conversation = await conversations.findById(conversationId).orFail();
    expect(conversation.lastMessage).toBe('$newer');
    expect(conversation.lastMessageId?.toString()).toBe(newer.id);
    expect(conversation.unreadCounts.recipient).toBe(2);
    expect(
      await messages.countDocuments({
        conversationId: new Types.ObjectId(conversationId),
      }),
    ).toBe(2);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('recovers a write that already updated the conversation without counting it twice', async () => {
    jest.spyOn(messages, 'findOneAndUpdate').mockImplementationOnce(failWrite);
    await service.sendMessage('sender', conversationId, { content: 'message' });
    expect(
      (await conversations.findById(conversationId).orFail()).unreadCounts
        .recipient,
    ).toBe(1);

    await waitForRecovery();
    expect(
      (await conversations.findById(conversationId).orFail()).unreadCounts
        .recipient,
    ).toBe(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('applies simultaneous sends once each and keeps the newest preview', async () => {
    const sent = await Promise.all(
      ['first', 'second', 'third', 'fourth'].map((content) =>
        service.sendMessage('sender', conversationId, { content }),
      ),
    );
    await waitForRecovery();

    const newest = sent.sort(
      (a, b) =>
        Number(b.createdAt) - Number(a.createdAt) || b.id.localeCompare(a.id),
    )[0];
    const conversation = await conversations.findById(conversationId).orFail();
    expect(conversation.lastMessageId?.toString()).toBe(newest.id);
    expect(conversation.unreadCounts.recipient).toBe(sent.length);
    expect(broadcast).toHaveBeenCalledTimes(sent.length);
  });

  it('does not restore unread after the recipient reads a saved message awaiting recovery', async () => {
    jest.spyOn(conversations, 'updateOne').mockImplementationOnce(failWrite);
    await service.sendMessage('sender', conversationId, { content: 'read me' });
    await service.markRead('recipient', conversationId);
    await waitForRecovery();

    const conversation = await conversations.findById(conversationId).orFail();
    expect(conversation.lastMessage).toBe('read me');
    expect(conversation.unreadCounts.recipient).toBe(0);
  });
});
