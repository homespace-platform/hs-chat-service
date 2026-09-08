import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiResponseDto } from '../../../common/dto/api-response.dto';
import type { UserContext } from '../../authentication/domain/user-context';
import { CurrentUser } from '../../authentication/presentation/decorators/current-user.decorator';
import { GatewayAuthenticationGuard } from '../../authentication/presentation/guards/gateway-authentication.guard';
import { ChatConversationService } from '../application/chat-conversation.service';
import { ChatMessageService } from '../application/chat-message.service';
import { CreateConversationDto } from '../application/dto/create-conversation.dto';
import { ListConversationsDto } from '../application/dto/list-conversations.dto';
import { ListMessagesDto } from '../application/dto/list-messages.dto';
import { SendMessageDto } from '../application/dto/send-message.dto';
import { UpdateParticipantRoleDto } from '../application/dto/update-participant-role.dto';

@Controller('conversations')
@UseGuards(GatewayAuthenticationGuard)
export class ChatController {
  constructor(
    private readonly conversationService: ChatConversationService,
    private readonly messageService: ChatMessageService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: UserContext,
    @Query() query: ListConversationsDto,
  ) {
    const result = await this.conversationService.listConversations(
      user.userId,
      query.limit,
    );
    return new ApiResponseDto({ result });
  }

  @Post()
  async create(
    @CurrentUser() user: UserContext,
    @Body() input: CreateConversationDto,
  ) {
    const result = await this.conversationService.createOrReuseConversation(
      user.userId,
      input,
    );
    return new ApiResponseDto({ result });
  }

  @Get(':conversationId/messages')
  async messages(
    @CurrentUser() user: UserContext,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesDto,
  ) {
    const result = await this.messageService.listMessages(
      user.userId,
      conversationId,
      query,
    );
    return new ApiResponseDto({ result });
  }

  @Post(':conversationId/messages')
  async send(
    @CurrentUser() user: UserContext,
    @Param('conversationId') conversationId: string,
    @Body() input: SendMessageDto,
  ) {
    const result = await this.messageService.sendMessage(
      user.userId,
      conversationId,
      input,
    );
    return new ApiResponseDto({ result });
  }

  @Patch(':conversationId/read')
  async read(
    @CurrentUser() user: UserContext,
    @Param('conversationId') conversationId: string,
  ) {
    const result = await this.messageService.markRead(
      user.userId,
      conversationId,
    );
    return new ApiResponseDto({ result });
  }

  @Patch(':conversationId/participant-role')
  async updateParticipantRole(
    @CurrentUser() user: UserContext,
    @Param('conversationId') conversationId: string,
    @Body() input: UpdateParticipantRoleDto,
  ) {
    const result = await this.conversationService.updateParticipantRole(
      conversationId,
      user.userId,
      input,
    );
    return new ApiResponseDto({ result });
  }
}
