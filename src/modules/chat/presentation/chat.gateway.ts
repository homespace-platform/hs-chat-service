import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { ChatMessageService } from '../application/chat-message.service';
import { ChatConversationService } from '../application/chat-conversation.service';
import { SendMessageDto } from '../application/dto/send-message.dto';
import { ChatMessageBroadcaster, chatPresenceRoom } from '../application/chat-message-broadcaster';
import { ChatCallHistoryService } from '../application/chat-call-history.service';

class SendRealtimeMessageDto extends SendMessageDto {
  @IsString()
  @IsNotEmpty()
  conversationId!: string;
}

class CallInviteDto {
  @IsMongoId()
  conversationId!: string;

  @IsUUID('4')
  callId!: string;

  @IsIn(['voice', 'video'])
  mode!: 'voice' | 'video';

  @ValidateIf((_, value) => value !== undefined)
  @IsIn([1])
  historyVersion?: 1;
}

class CallKeyDto {
  @IsMongoId()
  conversationId!: string;

  @IsUUID('4')
  callId!: string;
}

class CallEndDto extends CallKeyDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['declined', 'failed'])
  reason?: 'declined' | 'failed';
}

class MessageActionDto {
  @IsMongoId()
  conversationId!: string;

  @IsMongoId()
  messageId!: string;
}

class PinMessageDto extends MessageActionDto {
  @IsBoolean()
  pinned!: boolean;
}

class PresenceDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(128, { each: true })
  userIds!: string[];
}

// Delay before announcing offline so page reloads do not flicker.
const OFFLINE_GRACE_MS = 4000;

// ponytail: one replica uses Socket.IO's in-memory adapter; add Redis before scaling chat horizontally.
@WebSocketGateway({
  path: '/socket.io',
})
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => new WsException(errors),
  }),
)
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  // shortcut: presence is per process (in-memory adapter, single replica) and lastSeenAt is lost on restart; move to Redis adapter fetchSockets + persisted lastSeenAt before scaling out.
  private readonly socketCounts = new Map<string, number>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastSeen = new Map<string, Date>();

  constructor(
    private readonly messageService: ChatMessageService,
    private readonly conversationService: ChatConversationService,
    private readonly broadcaster: ChatMessageBroadcaster,
    private readonly callHistory: ChatCallHistoryService,
  ) {}

  afterInit(server: Server) {
    this.broadcaster.setServer(server);
    server.use((socket, next) => {
      const value = socket.handshake.headers['x-user-id'];
      const userId = (Array.isArray(value) ? value[0] : value)?.trim();
      if (!userId) return next(new Error('Unauthenticated'));

      socket.data.userId = userId;
      next();
    });
  }

  handleConnection(socket: Socket) {
    const userId = socket.data.userId as string;
    void socket.join(this.userRoom(userId));

    const previous = this.socketCounts.get(userId) ?? 0;
    this.socketCounts.set(userId, previous + 1);
    const pending = this.offlineTimers.get(userId);
    if (pending) {
      // Reconnected within the grace period: offline was never announced.
      clearTimeout(pending);
      this.offlineTimers.delete(userId);
    } else if (previous === 0) {
      this.lastSeen.delete(userId);
      this.emitPresence(userId, true, null);
    }
  }

  handleDisconnect(socket: Socket) {
    const userId = socket.data.userId as string | undefined;
    const count = userId ? this.socketCounts.get(userId) : undefined;
    if (!userId || !count) return;
    if (count > 1) {
      this.socketCounts.set(userId, count - 1);
      return;
    }

    this.socketCounts.delete(userId);
    const timer = setTimeout(() => {
      this.offlineTimers.delete(userId);
      const lastSeenAt = new Date();
      this.lastSeen.set(userId, lastSeenAt);
      this.emitPresence(userId, false, lastSeenAt.toISOString());
    }, OFFLINE_GRACE_MS);
    timer.unref();
    this.offlineTimers.set(userId, timer);
  }

  @SubscribeMessage('chat:presence:subscribe')
  async subscribePresence(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: PresenceDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    const allowed = await this.conversationService.findSharedParticipantIds(
      userId,
      [...new Set(input.userIds)],
    );
    await Promise.all(allowed.map((id) => socket.join(chatPresenceRoom(id))));
    return {
      presences: allowed.map((id) => ({
        userId: id,
        online: this.isOnline(id),
        lastSeenAt: this.lastSeen.get(id)?.toISOString() ?? null,
      })),
    };
  }

  @SubscribeMessage('chat:presence:unsubscribe')
  async unsubscribePresence(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: PresenceDto,
  ) {
    if (!socket.data.userId) throw new WsException('Unauthenticated');

    await Promise.all(
      [...new Set(input.userIds)].map((id) =>
        socket.leave(chatPresenceRoom(id)),
      ),
    );
    return { ok: true };
  }

  @SubscribeMessage('chat:send')
  async send(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: SendRealtimeMessageDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    try {
      return await this.messageService.sendMessage(
        userId,
        input.conversationId,
        input,
      );
    } catch (error) {
      throw new WsException(
        error instanceof Error ? error.message : 'Unable to send message',
      );
    }
  }

  @SubscribeMessage('chat:message:pin')
  async pinMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: PinMessageDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    const message = await this.messageService.setPinned(
      userId,
      input.conversationId,
      input.messageId,
      input.pinned,
    );
    this.server.to(this.userRoom(userId)).emit('chat:message:updated', message);
    return message;
  }

  @SubscribeMessage('chat:message:delete')
  async deleteMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: MessageActionDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    const result = await this.messageService.deleteForUser(
      userId,
      input.conversationId,
      input.messageId,
    );
    this.server.to(this.userRoom(userId)).emit('chat:message:deleted', result);
    return result;
  }

  @SubscribeMessage('chat:message:recall')
  async recallMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: MessageActionDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    const result = await this.messageService.recall(
      userId,
      input.conversationId,
      input.messageId,
    );
    this.server
      .to(result.participantIds.map((id) => this.userRoom(id)))
      .emit('chat:message:updated', result.message);
    return result.message;
  }

  @SubscribeMessage('chat:call:history-ready')
  async registerCallHistory(@ConnectedSocket() socket: Socket) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');
    await socket.join(this.callHistoryRoom(userId));
    return { ok: true, historyVersion: 1 };
  }

  @SubscribeMessage('chat:call:invite')
  async inviteCall(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: CallInviteDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    const conversation = await this.conversationService.getParticipantOrThrow(
      input.conversationId,
      userId,
    );
    const recipientId = conversation.participantIds.find(
      (participantId) => participantId !== userId,
    );
    if (!recipientId) throw new WsException('Call recipient not found');

    const { historyVersion, ...invite } = input;
    const readyRoom = this.callHistoryRoom(recipientId);
    let tracked = false;
    if (historyVersion === 1) {
      const sockets = await this.server
        .in(this.userRoom(recipientId))
        .fetchSockets();
      tracked = sockets.length === 0 ||
        sockets.some((peer) => peer.rooms.has(readyRoom));
    }
    const result = await this.callHistory.invite(
      invite,
      userId,
      recipientId,
      invite.mode === 'voice' ? 'audio' : 'video',
      tracked,
    );
    const call = {
      ...invite,
      callerId: userId,
      ...(result.tracked && { historyVersion: 1 }),
    };
    if (result.relay) {
      this.server
        .to(result.tracked ? readyRoom : this.userRoom(recipientId))
        .emit('chat:call:incoming', call);
    }
    return call;
  }

  @SubscribeMessage('chat:call:accept')
  async acceptCall(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: CallKeyDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');
    await this.conversationService.getParticipantOrThrow(
      input.conversationId,
      userId,
    );
    await this.callHistory.accept(input, userId);
    return input;
  }

  @SubscribeMessage('chat:call:end')
  async endCall(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: CallEndDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    const conversation = await this.conversationService.getParticipantOrThrow(
      input.conversationId,
      userId,
    );
    if (await this.callHistory.end(input, userId, input.reason)) return input;
    this.server
      .to(conversation.participantIds.map((id) => this.userRoom(id)))
      .emit('chat:call:ended', input);
    return input;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private callHistoryRoom(userId: string) {
    return `call-history:${userId}`;
  }

  // Still "online" during the disconnect grace period.
  private isOnline(userId: string) {
    return this.socketCounts.has(userId) || this.offlineTimers.has(userId);
  }

  private emitPresence(
    userId: string,
    online: boolean,
    lastSeenAt: string | null,
  ) {
    this.server
      .to(chatPresenceRoom(userId))
      .emit('chat:presence', { userId, online, lastSeenAt });
  }
}
