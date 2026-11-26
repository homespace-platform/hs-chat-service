import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { S3Client, type HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import { ChatMediaService } from '../../src/modules/chat/application/chat-media.service';
import type { ChatAsset } from '../../src/modules/chat/infrastructure/persistence/schemas/chat-asset.schema';

const conversationId = '507f1f77bcf86cd799439011';
const storageId = 'chat_7a07a349-4f7a-4d31-9d6f-386654ed2665';
const query = <T>(value: T) => ({
  exec: async () => value,
  lean: () => ({ exec: async () => value }),
});
const attachment = {
  storageId,
  fileName: 'room.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 100,
};
function asset(overrides: Partial<ChatAsset> = {}) {
  return {
    _id: storageId,
    conversationId,
    ownerId: 'sender',
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    bucketName: 'homespace-test-chat',
    objectKey: `private/chat/${conversationId}/${storageId}.jpg`,
    status: 'READY',
    versionId: 'signed-version',
    save: jest.fn(async () => {}),
    ...overrides,
  };
}

describe('ChatMediaService private storage', () => {
  const assets = {
    create: jest.fn(async (_input: unknown) => {}),
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const messages = {
    exists: jest.fn<(...args: unknown[]) => Promise<object | null>>(),
  };
  const conversations = {
    getParticipantOrThrow: jest.fn<(...args: unknown[]) => Promise<object>>(),
  };
  const s3 = new S3Client({
    region: 'ap-southeast-1',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    },
  });
  const send =
    jest.fn<(...args: unknown[]) => Promise<HeadObjectCommandOutput>>();
  Object.assign(s3, { send });
  const service = new ChatMediaService(
    assets as never,
    messages as never,
    conversations as never,
    s3,
    { get: () => 'homespace-test-chat' } as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    conversations.getParticipantOrThrow.mockResolvedValue({
      _id: conversationId,
    });
  });
  afterAll(() => s3.destroy());

  it('presigns upload inside private/chat and records verified owner/conversation', async () => {
    const result = await service.createUpload('sender', conversationId, {
      fileName: 'room.jpg',
      contentType: 'image/jpeg',
      size: 100,
    });
    const url = new URL(result.uploadUrl);
    expect(result.storageId).toMatch(/^chat_[0-9a-f-]{36}$/);
    expect(url.pathname).toBe(
      `/private/chat/${conversationId}/${result.storageId}.jpg`,
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(assets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'sender',
        conversationId,
        status: 'PENDING',
        bucketName: 'homespace-test-chat',
      }),
    );
    expect(send).not.toHaveBeenCalled(); // Signing is local; no S3 network request in this test.
  });

  it('rejects outsiders before creating uploads or reading assets', async () => {
    conversations.getParticipantOrThrow.mockRejectedValue(
      new NotFoundException(),
    );
    await expect(
      service.createUpload('outsider', conversationId, {
        fileName: 'x.jpg',
        contentType: 'image/jpeg',
        size: 100,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.completeUpload('outsider', conversationId, storageId),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getViewUrl('outsider', conversationId, storageId),
    ).rejects.toThrow(NotFoundException);
    expect(assets.create).not.toHaveBeenCalled();
    expect(assets.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ['xls', 'application/vnd.ms-excel'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['ppt', 'application/vnd.ms-powerpoint'],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('presigns %s uploads using the allowed MIME type', async (extension, contentType) => {
    const result = await service.createUpload('sender', conversationId, {
      fileName: `file.${extension}`,
      contentType,
      size: 100,
    });
    expect(new URL(result.uploadUrl).pathname).toMatch(new RegExp(`\\.${extension}$`));
  });

  it.each([
    { fileName: 'x.html', contentType: 'text/html', size: 100 },
    { fileName: 'x.jpg', contentType: 'toString', size: 100 },
    { fileName: 'x.pdf', contentType: 'application/pdf', size: 0 },
    {
      fileName: 'x.pdf',
      contentType: 'application/pdf',
      size: 25 * 1024 * 1024 + 1,
    },
  ])('rejects unsupported or oversized uploads: %j', async (input) => {
    await expect(
      service.createUpload('sender', conversationId, input),
    ).rejects.toThrow(BadRequestException);
    expect(assets.create).not.toHaveBeenCalled();
  });

  it('verifies uploaded content and pins the exact S3 version before READY', async () => {
    const pending = asset({ status: 'PENDING', versionId: undefined });
    assets.findOne.mockReturnValue(query(pending));
    send.mockResolvedValue({
      ContentLength: 100,
      ContentType: 'image/jpeg',
      VersionId: 'immutable-version',
      $metadata: {},
    });
    expect(
      await service.completeUpload('sender', conversationId, storageId),
    ).toEqual(attachment);
    expect(assets.findOne).toHaveBeenCalledWith({
      _id: storageId,
      conversationId,
      ownerId: 'sender',
    });
    expect(pending.status).toBe('READY');
    expect(pending.versionId).toBe('immutable-version');
    expect(pending.save).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched uploads and buckets without a real Version ID', async () => {
    const pending = asset({ status: 'PENDING', versionId: undefined });
    assets.findOne.mockReturnValue(query(pending));
    send.mockResolvedValue({
      ContentLength: 99,
      ContentType: 'image/jpeg',
      VersionId: 'v1',
      $metadata: {},
    });
    await expect(
      service.completeUpload('sender', conversationId, storageId),
    ).rejects.toThrow('does not match');
    expect(pending.status).toBe('REJECTED');
    const unversioned = asset({ status: 'PENDING', versionId: undefined });
    assets.findOne.mockReturnValue(query(unversioned));
    send.mockResolvedValue({
      ContentLength: 100,
      ContentType: 'image/jpeg',
      VersionId: 'null',
      $metadata: {},
    });
    await expect(
      service.completeUpload('sender', conversationId, storageId),
    ).rejects.toThrow('versioning');
    expect(unversioned.status).toBe('PENDING');
  });

  it('cannot complete another participant upload even inside the same conversation', async () => {
    assets.findOne.mockReturnValue(query(null));
    await expect(
      service.completeUpload('other', conversationId, storageId),
    ).rejects.toThrow(NotFoundException);
    expect(assets.findOne).toHaveBeenCalledWith({
      _id: storageId,
      conversationId,
      ownerId: 'other',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('loads attachment metadata from owned READY assets instead of trusting message input', async () => {
    assets.find.mockReturnValue(query([asset()]));
    expect(
      await service.resolveAttachments('sender', conversationId, [
        { ...attachment, fileName: 'forged', sizeBytes: 9 },
      ]),
    ).toEqual([attachment]);
    expect(assets.find).toHaveBeenCalledWith({
      _id: { $in: [storageId] },
      ownerId: 'sender',
      conversationId,
      status: 'READY',
    });
    assets.find.mockReturnValue(query([]));
    await expect(
      service.resolveAttachments('other', conversationId, [attachment]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate, legacy, unfinished, and too many new attachments', async () => {
    await expect(
      service.resolveAttachments('sender', conversationId, [
        attachment,
        attachment,
      ]),
    ).rejects.toThrow();
    await expect(
      service.resolveAttachments('sender', conversationId, [
        { ...attachment, storageId: 'core-storage-id' },
      ]),
    ).rejects.toThrow();
    await expect(
      service.resolveAttachments(
        'sender',
        conversationId,
        Array(6).fill(attachment),
      ),
    ).rejects.toThrow();
    assets.find.mockReturnValue(query([asset({ versionId: undefined })]));
    await expect(
      service.resolveAttachments('sender', conversationId, [attachment]),
    ).rejects.toThrow();
    expect(await service.resolveAttachments('sender', conversationId)).toEqual(
      [],
    );
  });

  it('does not let the recipient read unshared or recalled/hidden attachments', async () => {
    assets.findOne.mockReturnValue(query(asset()));
    messages.exists.mockResolvedValue(null);
    await expect(
      service.getViewUrl('recipient', conversationId, storageId),
    ).rejects.toThrow(NotFoundException);
    expect(messages.exists).toHaveBeenCalledWith({
      conversationId,
      'attachments.storageId': storageId,
      hiddenFor: { $ne: 'recipient' },
      recalledAt: { $exists: false },
    });
  });

  it('gives a member a short-lived URL for the stored version, never latest', async () => {
    assets.findOne.mockReturnValue(query(asset()));
    messages.exists.mockResolvedValue({ _id: 'message' });
    const result = await service.getViewUrl(
      'recipient',
      conversationId,
      storageId,
    );
    const url = new URL(result.url);
    expect(url.searchParams.get('versionId')).toBe('signed-version');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(url.pathname).toContain('/private/chat/');
  });

  it.each([
    ['application/pdf', 'inline'],
    ['application/vnd.ms-powerpoint', 'attachment'],
  ])('selects the signed download disposition for %s', async (contentType, disposition) => {
    assets.findOne.mockReturnValue(query(asset({ contentType })));
    const result = await service.getViewUrl('sender', conversationId, storageId);
    expect(new URL(result.url).searchParams.get('response-content-disposition')).toBe(disposition);
  });
});
