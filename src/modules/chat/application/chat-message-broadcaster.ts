import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { MessageView } from '../domain/chat-views';

@Injectable()
export class ChatMessageBroadcaster {
  private server?: Server;

  setServer(server: Server) {
    this.server = server;
  }

  broadcast(message: MessageView, senderId: string, recipientId: string) {
    this.server
      ?.to([`user:${senderId}`, `user:${recipientId}`])
      .emit('chat:message', message);
  }
}
