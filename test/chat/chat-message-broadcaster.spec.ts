import { jest } from '@jest/globals';
import { ChatMessageBroadcaster } from '../../src/modules/chat/application/chat-message-broadcaster';

it('broadcasts the existing message payload to both participant rooms', () => {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const broadcaster = new ChatMessageBroadcaster();
  broadcaster.setServer({ to } as never);
  const message = { id: 'message-1' } as never;

  broadcaster.broadcast(message, 'user-a', 'user-b');

  expect(to).toHaveBeenCalledWith(['user:user-a', 'user:user-b']);
  expect(emit).toHaveBeenCalledWith('chat:message', message);
});

it('sends profile invalidation only to the authorized presence room', () => {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const broadcaster = new ChatMessageBroadcaster();
  broadcaster.setServer({ to } as never);

  broadcaster.broadcastProfileChange('user-a');

  expect(to).toHaveBeenCalledWith('presence:user-a');
  expect(emit).toHaveBeenCalledWith('chat:profile:changed', { userId: 'user-a' });
});
