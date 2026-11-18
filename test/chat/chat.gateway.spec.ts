import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ChatGateway } from '../../src/modules/chat/presentation/chat.gateway';

describe('ChatGateway', () => {
  const conversationService = {
    getParticipantOrThrow: jest.fn(),
  };

  it('accepts only users authenticated by the gateway', () => {
    let authenticate!: (socket: never, next: (error?: Error) => void) => void;
    const gateway = new ChatGateway({} as never, conversationService as never, { setServer: jest.fn() } as never);
    gateway.afterInit({
      use: (middleware: typeof authenticate) => {
        authenticate = middleware;
      },
    } as never);
    Object.assign(gateway, { server: { to: () => ({ emit: jest.fn() }) } });
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

  it('delegates a socket send once to the shared send path', async () => {
    const message = { id: 'message-id', conversationId: 'conversation-id' };
    const messageService = {
      sendMessage: jest.fn<() => Promise<typeof message>>().mockResolvedValue(message),
    };
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const gateway = new ChatGateway(
      messageService as never,
      conversationService as never,
      { setServer: jest.fn() } as never,
    );
    Object.assign(gateway, { server: { to } });

    const result = await gateway.send({ data: { userId: 'user-a' } } as never, {
      conversationId: 'conversation-id',
      content: 'Xin chao',
    });

    expect(messageService.sendMessage).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
      { conversationId: 'conversation-id', content: 'Xin chao' },
    );
    expect(messageService.sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe(message);
    expect(emit).not.toHaveBeenCalled();
  });

  it('invites only the other conversation participant', async () => {
    conversationService.getParticipantOrThrow.mockResolvedValueOnce({
      participantIds: ['user-a', 'user-b'],
    });
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const gateway = new ChatGateway({} as never, conversationService as never, { setServer: jest.fn() } as never);
    Object.assign(gateway, { server: { to } });
    const call = {
      conversationId: '507f1f77bcf86cd799439011',
      callId: '123e4567-e89b-42d3-a456-426614174000',
      mode: 'video' as const,
    };

    await gateway.inviteCall({ data: { userId: 'user-a' } } as never, call);

    expect(conversationService.getParticipantOrThrow).toHaveBeenCalledWith(
      call.conversationId,
      'user-a',
    );
    expect(to).toHaveBeenCalledWith('user:user-b');
    expect(emit).toHaveBeenCalledWith('chat:call:incoming', {
      ...call,
      callerId: 'user-a',
    });
  });

  describe('presence', () => {
    function setup() {
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      const service = {
        findSharedParticipantIds: jest.fn<(u: string, ids: string[]) => Promise<string[]>>(),
      };
      const gateway = new ChatGateway({} as never, service as never, { setServer: jest.fn() } as never);
      Object.assign(gateway, { server: { to } });
      const socket = (userId: string) =>
        ({ data: { userId }, join: jest.fn(), leave: jest.fn() }) as never as {
          data: { userId: string };
          join: jest.Mock;
          leave: jest.Mock;
        };
      return { gateway, service, emit, to, socket };
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('subscribes only to users sharing a conversation and acks their presence', async () => {
      const { gateway, service, socket } = setup();
      const watcher = socket('user-a');
      gateway.handleConnection(socket('user-b') as never);
      service.findSharedParticipantIds.mockResolvedValueOnce(['user-b', 'user-c']);

      const result = await gateway.subscribePresence(watcher as never, {
        userIds: ['user-b', 'user-c', 'stranger', 'user-b'],
      });

      expect(service.findSharedParticipantIds).toHaveBeenCalledWith('user-a', [
        'user-b',
        'user-c',
        'stranger',
      ]);
      expect(watcher.join).toHaveBeenCalledTimes(2);
      expect(watcher.join).toHaveBeenCalledWith('presence:user-b');
      expect(watcher.join).not.toHaveBeenCalledWith('presence:stranger');
      expect(result).toEqual({
        presences: [
          { userId: 'user-b', online: true, lastSeenAt: null },
          { userId: 'user-c', online: false, lastSeenAt: null },
        ],
      });
    });

    it('emits only on 0->1 and 1->0 transitions across multiple tabs', () => {
      const { gateway, emit, to, socket } = setup();
      const tab1 = socket('user-b');
      const tab2 = socket('user-b');

      gateway.handleConnection(tab1 as never);
      gateway.handleConnection(tab2 as never);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith('presence:user-b');
      expect(emit).toHaveBeenCalledWith('chat:presence', {
        userId: 'user-b',
        online: true,
        lastSeenAt: null,
      });

      gateway.handleDisconnect(tab1 as never);
      jest.advanceTimersByTime(10_000);
      expect(emit).toHaveBeenCalledTimes(1);

      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      gateway.handleDisconnect(tab2 as never);
      jest.advanceTimersByTime(4000);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit).toHaveBeenLastCalledWith('chat:presence', {
        userId: 'user-b',
        online: false,
        lastSeenAt: '2026-01-01T00:00:04.000Z',
      });
    });

    it('does not announce offline when the user reconnects within the grace period', async () => {
      const { gateway, service, emit, socket } = setup();
      const first = socket('user-b');
      gateway.handleConnection(first as never);
      emit.mockClear();

      gateway.handleDisconnect(first as never);
      jest.advanceTimersByTime(2000);
      gateway.handleConnection(socket('user-b') as never);
      jest.advanceTimersByTime(10_000);
      expect(emit).not.toHaveBeenCalled();

      service.findSharedParticipantIds.mockResolvedValueOnce(['user-b']);
      const result = await gateway.subscribePresence(socket('user-a') as never, {
        userIds: ['user-b'],
      });
      expect(result.presences[0]).toEqual({ userId: 'user-b', online: true, lastSeenAt: null });
    });

    it('reports lastSeenAt after the grace period and treats grace as still online', async () => {
      const { gateway, service, socket } = setup();
      const tab = socket('user-b');
      gateway.handleConnection(tab as never);
      service.findSharedParticipantIds.mockResolvedValue(['user-b']);

      gateway.handleDisconnect(tab as never);
      const during = await gateway.subscribePresence(socket('user-a') as never, { userIds: ['user-b'] });
      expect(during.presences[0]?.online).toBe(true);

      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      jest.advanceTimersByTime(4000);
      const after = await gateway.subscribePresence(socket('user-a') as never, { userIds: ['user-b'] });
      expect(after.presences[0]).toEqual({
        userId: 'user-b',
        online: false,
        lastSeenAt: '2026-01-01T00:00:04.000Z',
      });
    });

    it('unsubscribes by leaving the presence rooms', async () => {
      const { gateway, socket } = setup();
      const watcher = socket('user-a');

      const result = await gateway.unsubscribePresence(watcher as never, {
        userIds: ['user-b', 'user-b', 'user-c'],
      });

      expect(result).toEqual({ ok: true });
      expect(watcher.leave).toHaveBeenCalledTimes(2);
      expect(watcher.leave).toHaveBeenCalledWith('presence:user-b');
      expect(watcher.leave).toHaveBeenCalledWith('presence:user-c');
    });
  });
});
