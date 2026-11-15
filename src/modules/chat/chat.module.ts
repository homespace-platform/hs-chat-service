import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { MongooseModule } from '@nestjs/mongoose';
import { GatewayAuthenticationGuard } from '../authentication/presentation/guards/gateway-authentication.guard';
import { ChatConversationService } from './application/chat-conversation.service';
import { ChatCallService } from './application/chat-call.service';
import { ChatMessageService } from './application/chat-message.service';
import { ChatMessageBroadcaster } from './application/chat-message-broadcaster';
import { ChatNotificationPublisher } from './application/chat-notification-publisher';
import { ChatController } from './presentation/chat.controller';
import { ChatGateway } from './presentation/chat.gateway';
import { ChatMediaService } from './application/chat-media.service';
import { ChatMediaController } from './presentation/chat-media.controller';
import {
  ChatAsset,
  ChatAssetSchema,
} from './infrastructure/persistence/schemas/chat-asset.schema';
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
      { name: ChatAsset.name, schema: ChatAssetSchema },
    ]),
  ],
  controllers: [ChatController, ChatMediaController],
  providers: [
    GatewayAuthenticationGuard,
    ChatConversationService,
    ChatCallService,
    ChatMessageService,
    ChatMessageBroadcaster,
    ChatNotificationPublisher,
    ChatGateway,
    ChatMediaService,
    {
      provide: S3Client,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3Client({
          region: config.get<string>('AWS_REGION') || 'ap-southeast-1',
          requestChecksumCalculation: 'WHEN_REQUIRED',
        }),
    },
  ],
  exports: [MongooseModule],
})
export class ChatModule {}
