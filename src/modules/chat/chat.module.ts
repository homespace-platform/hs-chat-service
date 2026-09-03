import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GatewayAuthenticationGuard } from '../authentication/presentation/guards/gateway-authentication.guard';
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
  providers: [GatewayAuthenticationGuard],
  exports: [MongooseModule],
})
export class ChatModule {}
