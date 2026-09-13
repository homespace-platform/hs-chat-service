import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GatewayAuthenticationGuard } from '../authentication/presentation/guards/gateway-authentication.guard';
import { ChatConversationService } from './application/chat-conversation.service';
import { ChatCallService } from './application/chat-call.service';
import { ChatMessageService } from './application/chat-message.service';
import { ChatController } from './presentation/chat.controller';
import { ChatGateway } from './presentation/chat.gateway';
import {
  Conversation,
  ConversationSchema,
} from './infrastructure/persistence/schemas/conversation.schema';
import {
  Message,
  MessageSchema,
} from './infrastructure/persistence/schemas/message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [ChatController],
  providers: [
    GatewayAuthenticationGuard,
    ChatConversationService,
    ChatCallService,
    ChatMessageService,
    ChatGateway,
  ],
  exports: [MongooseModule],
})
export class ChatModule {}
