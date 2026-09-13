import { IsIn, IsMongoId, IsNotEmpty, IsString, IsUUID } from 'class-validator';
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
