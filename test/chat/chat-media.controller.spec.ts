import 'reflect-metadata';
import { jest } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChatMediaController } from '../../src/modules/chat/presentation/chat-media.controller';
import { GatewayAuthenticationGuard } from '../../src/modules/authentication/presentation/guards/gateway-authentication.guard';
import { CreateChatUploadDto } from '../../src/modules/chat/application/dto/chat-upload.dto';

describe('ChatMediaController', () => {
  it('protects every media route with Gateway identity and passes that identity to storage', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ChatMediaController)).toContain(GatewayAuthenticationGuard);
    const result = { storageId: 'chat_uuid' };
    const media = {
      createUpload: jest.fn(async (..._args: unknown[]) => result),
      completeUpload: jest.fn(async (..._args: unknown[]) => result),
      getViewUrl: jest.fn(async (..._args: unknown[]) => ({ url: 'https://s3.example/signed' })),
    };
    const controller = new ChatMediaController(media as never);
    const user = { userId: 'verified-user', authorities: [] };
    const input = { fileName: 'room.jpg', contentType: 'image/jpeg', size: 100 };
    await controller.create(user, 'conversation', input);
    await controller.complete(user, 'conversation', 'chat_uuid');
    await controller.view(user, 'conversation', 'chat_uuid');
    expect(media.createUpload).toHaveBeenCalledWith('verified-user', 'conversation', input);
    expect(media.completeUpload).toHaveBeenCalledWith('verified-user', 'conversation', 'chat_uuid');
    expect(media.getViewUrl).toHaveBeenCalledWith('verified-user', 'conversation', 'chat_uuid');
  });

  it('rejects forged identity and unsupported upload metadata at the request boundary', () => {
    const input = plainToInstance(CreateChatUploadDto, {
      fileName: 'x.html', contentType: 'text/html', size: 26 * 1024 * 1024, userId: 'forged-owner',
    });
    const errors = validateSync(input, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['userId', 'contentType', 'size']));
  });
});
