import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { ChatMessageService } from '../application/chat-message.service';
import { ChatConversationService } from '../application/chat-conversation.service';
import { SendMessageDto } from '../application/dto/send-message.dto';

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
}

class CallEndDto {
  @IsMongoId()
  conversationId!: string;

  @IsUUID('4')
  callId!: string;
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
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly messageService: ChatMessageService,
    private readonly conversationService: ChatConversationService,
  ) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      const value = socket.handshake.headers['x-user-id'];
      const userId = (Array.isArray(value) ? value[0] : value)?.trim();
      if (!userId) return next(new Error('Unauthenticated'));

      socket.data.userId = userId;
      next();
    });
  }

  handleConnection(socket: Socket) {
    void socket.join(this.userRoom(socket.data.userId as string));
  }

  @SubscribeMessage('chat:send')
  async send(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: SendRealtimeMessageDto,
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthenticated');

    try {
      const { message, recipientId } =
        await this.messageService.sendRealtimeMessage(
          userId,
          input.conversationId,
          input,
        );
      this.server
        .to([this.userRoom(userId), this.userRoom(recipientId)])
        .emit('chat:message', message);
      return message;
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

    const call = { ...input, callerId: userId };
    this.server.to(this.userRoom(recipientId)).emit('chat:call:incoming', call);
    return call;
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
    this.server
      .to(conversation.participantIds.map((id) => this.userRoom(id)))
      .emit('chat:call:ended', input);
    return input;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }
}
