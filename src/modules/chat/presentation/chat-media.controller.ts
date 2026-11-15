import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiResponseDto } from '../../../common/dto/api-response.dto';
import type { UserContext } from '../../authentication/domain/user-context';
import { CurrentUser } from '../../authentication/presentation/decorators/current-user.decorator';
import { GatewayAuthenticationGuard } from '../../authentication/presentation/guards/gateway-authentication.guard';
import { ChatMediaService } from '../application/chat-media.service';
import { CreateChatUploadDto } from '../application/dto/chat-upload.dto';

@Controller('conversations/:conversationId/media')
@UseGuards(GatewayAuthenticationGuard)
export class ChatMediaController {
  constructor(private readonly media: ChatMediaService) {}

  @Post('uploads')
  async create(
    @CurrentUser() user: UserContext,
    @Param('conversationId') conversationId: string,
    @Body() input: CreateChatUploadDto,
  ) {
    return new ApiResponseDto({
      result: await this.media.createUpload(user.userId, conversationId, input),
    });
  }

  @Post(':storageId/complete')
  async complete(
    @CurrentUser() user: UserContext,
    @Param('conversationId') conversationId: string,
    @Param('storageId') storageId: string,
  ) {
    return new ApiResponseDto({
      result: await this.media.completeUpload(
        user.userId,
        conversationId,
        storageId,
      ),
    });
  }

  @Get(':storageId/view-url')
  async view(
    @CurrentUser() user: UserContext,
    @Param('conversationId') conversationId: string,
    @Param('storageId') storageId: string,
  ) {
    return new ApiResponseDto({
      result: await this.media.getViewUrl(
        user.userId,
        conversationId,
        storageId,
      ),
    });
  }
}
