import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ChatGateway } from '../../src/modules/chat/presentation/chat.gateway';

describe('ChatGateway', () => {
  it('accepts only users authenticated by the gateway', () => {
    let authenticate!: (socket: never, next: (error?: Error) => void) => void;
    const gateway = new ChatGateway({} as never);
    gateway.afterInit({
      use: (middleware: typeof authenticate) => {
        authenticate = middleware;
      },
    } as never);
    const join = jest.fn();
    const authenticated = jest.fn();

    authenticate(
      {
        handshake: { headers: { 'x-user-id': ' user-a ' } },
        data: {},
        join,
      } as never,
      authenticated,
    );

    gateway.handleConnection({ data: { userId: 'user-a' }, join } as never);
    expect(join).toHaveBeenCalledWith('user:user-a');
    expect(authenticated).toHaveBeenCalledWith();

    const rejected = jest.fn();
    authenticate(
      { handshake: { headers: {} }, data: {}, join: jest.fn() } as never,
      rejected,
    );
    expect(rejected.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('sends a message to both participant rooms', async () => {
    const message = { id: 'message-id', conversationId: 'conversation-id' };
    const messageService = {
      sendRealtimeMessage: jest.fn().mockResolvedValue({
        message,
        recipientId: 'user-b',
      }),
    };
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const gateway = new ChatGateway(messageService as never);
    Object.assign(gateway, { server: { to } });

    await gateway.send({ data: { userId: 'user-a' } } as never, {
      conversationId: 'conversation-id',
      content: 'Xin chao',
    });

    expect(messageService.sendRealtimeMessage).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
      { conversationId: 'conversation-id', content: 'Xin chao' },
    );
    expect(to).toHaveBeenCalledWith(['user:user-a', 'user:user-b']);
    expect(emit).toHaveBeenCalledWith('chat:message', message);
  });
});
