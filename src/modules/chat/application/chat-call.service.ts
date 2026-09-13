import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcRole, RtcTokenBuilder } from 'agora-token';
import { ChatConversationService } from './chat-conversation.service';

const TOKEN_TTL_SECONDS = 60 * 60;

@Injectable()
export class ChatCallService {
  constructor(
    private readonly config: ConfigService,
    private readonly conversationService: ChatConversationService,
  ) {}

  async createToken(conversationId: string, userId: string, callId: string) {
    await this.conversationService.getParticipantOrThrow(
      conversationId,
      userId,
    );

    const appId = this.config.get<string>('AGORA_APP_ID')?.trim();
    const appCertificate = this.config
      .get<string>('AGORA_APP_CERTIFICATE')
      ?.trim();
    if (!appId || !appCertificate) {
      throw new ServiceUnavailableException('Agora is not configured');
    }

    const channel = `hs_${callId.replaceAll('-', '')}`;
    const token = RtcTokenBuilder.buildTokenWithUserAccount(
      appId,
      appCertificate,
      channel,
      userId,
      RtcRole.PUBLISHER,
      TOKEN_TTL_SECONDS,
      TOKEN_TTL_SECONDS,
    );

    return { appId, channel, token, uid: userId, expiresIn: TOKEN_TTL_SECONDS };
  }
}
