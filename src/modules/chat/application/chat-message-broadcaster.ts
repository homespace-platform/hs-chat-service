import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { MessageView } from '../domain/chat-views';
import type { ChatCallKey } from '../domain/chat-call';

export const chatPresenceRoom = (userId: string) => 'presence:' + userId;

@Injectable()
export class ChatMessageBroadcaster {
  private server?: Server;

  setServer(server: Server) {
    this.server = server;
  }

  broadcastProfileChange(userId: string) {
    this.server?.to(chatPresenceRoom(userId)).emit('chat:profile:changed', { userId });
  }

  broadcast(message: MessageView, senderId: string, recipientId: string) {
    this.server
      ?.to([`user:${senderId}`, `user:${recipientId}`])
      .emit('chat:message', message);
  }

  broadcastCallEnded(callerId: string, calleeId: string, call: ChatCallKey) {
    this.server
      ?.to([`user:${callerId}`, `user:${calleeId}`])
      .emit('chat:call:ended', call);
  }
}
