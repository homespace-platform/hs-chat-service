# Chat Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat UI mock data with a standalone MongoDB-backed REST chat service for two authenticated users.

**Architecture:** `hs-chat-service` owns conversations and messages in MongoDB. The API Gateway keeps JWT validation and forwards `X-User-*` headers; the Nest service authorizes every operation from `UserContext`. After the backend contract passes, the web app replaces the demo provider with a thin API adapter.

**Tech Stack:** NestJS 12, Mongoose 9, MongoDB, class-validator, Jest 30, existing Eureka/Gateway integration, Next.js Axios client.

**Spec:** `docs/superpowers/specs/2026-09-03-chat-backend-design.md`

## Global Constraints

- REST only; do not add WebSocket or Socket.IO dependencies.
- MongoDB is the only chat persistence store; local prototype data may be dropped.
- Sender identity always comes from `X-User-Id`; never accept `senderId` from request bodies.
- Only the two conversation participants can read, send, or mark messages read.
- Keep the existing `{ code: 1000, result }` response wrapper and gateway route `/api/v1/chat/**`.
- Do not implement tenant/landlord authorization, AI persistence, file attachments, pinning, or hiding in this phase.
- Use already-installed dependencies; do not add a runtime package.

---

### Task 1: Add chat domain contracts and deterministic conversation identity

**Files:**
- Create: `src/modules/chat/domain/related-listing-snapshot.ts`
- Create: `src/modules/chat/domain/chat-views.ts`
- Create: `src/modules/chat/application/conversation-key.ts`
- Test: `test/chat/conversation-key.spec.ts`

**Interfaces:**
- `RelatedListingSnapshot`: `{ id, title, price, location, image, bedrooms?, area?, verified? }`.
- `ConversationView`: `{ id, participantId, participantName?, participantEmail?, listing?, lastMessage?, lastMessageAt?, lastMessageSenderId?, unreadCount }`.
- `MessageView`: `{ id, conversationId, senderId, content, listing?, createdAt }`.
- `MessagePage`: `{ items: MessageView[], nextBefore?: string }`.
- `buildParticipantKey(firstUserId: string, secondUserId: string): string` returns sorted IDs joined by `:` and rejects equal IDs.
- `DIRECT_CONVERSATION_LISTING_ID = '__direct__'`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('buildParticipantKey', () => {
  it('sorts IDs so both request orders produce the same key', () => {
    expect(buildParticipantKey('user-b', 'user-a')).toBe('user-a:user-b');
    expect(buildParticipantKey('user-a', 'user-b')).toBe('user-a:user-b');
  });

  it('rejects a self-conversation', () => {
    expect(() => buildParticipantKey('user-a', 'user-a')).toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --runInBand test/chat/conversation-key.spec.ts`

Expected: FAIL because the domain helper does not exist yet.

- [ ] **Step 3: Implement the minimal contracts and helper**

Use `Array.sort()` on a copy of the two IDs. Throw a plain `Error` for equal or blank IDs; the application service will translate this into a `BadRequestException`.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --runInBand test/chat/conversation-key.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/chat/domain test/chat/conversation-key.spec.ts
git commit -m "feat(chat): add conversation identity contracts"
```

### Task 2: Create MongoDB schemas and register ChatModule

**Files:**
- Create: `src/modules/chat/infrastructure/persistence/schemas/conversation.schema.ts`
- Create: `src/modules/chat/infrastructure/persistence/schemas/message.schema.ts`
- Create: `src/modules/chat/infrastructure/persistence/chat.persistence.types.ts`
- Create: `src/modules/chat/chat.module.ts`
- Modify: `src/app.module.ts`
- Test: `test/chat/chat-schemas.spec.ts`

**Interfaces:**
- `ConversationDocument`: `participantIds`, `participantKey`, `listingId`, `listing`, `lastMessage`, `lastMessageAt`, `lastMessageSenderId`, `unreadCounts`, timestamps.
- `MessageDocument`: `conversationId`, `senderId`, `content`, `listing`, `createdAt`.
- Mongoose model tokens: `Conversation` and `Message`.

- [ ] **Step 1: Write schema metadata tests**

```ts
it('uses a unique participant/listing index', () => {
  const indexes = ConversationSchema.indexes();
  expect(indexes).toContainEqual([
    { participantKey: 1, listingId: 1 },
    { unique: true },
  ]);
});

it('indexes messages by conversation and creation time', () => {
  expect(MessageSchema.indexes()).toContainEqual([
    { conversationId: 1, createdAt: 1 },
    {},
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --runInBand test/chat/chat-schemas.spec.ts`

Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement schemas**

Use `SchemaFactory.createForClass()`. Set `listingId` default to `DIRECT_CONVERSATION_LISTING_ID`, make `participantIds` and `participantKey` required, add timestamps, and define the two indexes. Define the listing snapshot as a small nested schema with `_id: false`; do not create a separate listing collection.

- [ ] **Step 4: Register the module**

Import `MongooseModule.forFeature([{ name: Conversation.name, schema: ConversationSchema }, { name: Message.name, schema: MessageSchema }])` in `ChatModule`, import `GatewayAuthenticationGuard`, and add `ChatModule` to `AppModule.imports`.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- --runInBand test/chat/chat-schemas.spec.ts` and `npm run build`

Expected: focused tests PASS and build exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts src/modules/chat test/chat/chat-schemas.spec.ts
git commit -m "feat(chat): add MongoDB persistence schemas"
```

### Task 3: Implement conversation creation, reuse, listing, and authorization

**Files:**
- Create: `src/modules/chat/application/dto/create-conversation.dto.ts`
- Create: `src/modules/chat/application/dto/list-conversations.dto.ts`
- Create: `src/modules/chat/application/chat-conversation.service.ts`
- Create: `test/chat/chat-conversation.service.spec.ts`

**Interfaces:**
- `createOrReuseConversation(currentUserId: string, input: CreateConversationDto): Promise<ConversationView>`.
- `listConversations(currentUserId: string, limit: number): Promise<ConversationView[]>`.
- `getParticipantOrThrow(conversationId: string, currentUserId: string): Promise<ConversationDocument>`.

- [ ] **Step 1: Write failing service tests**

Cover these exact cases with mocked model methods:

```ts
it('creates a conversation with sorted participants and a direct listing sentinel', async () => {
  const result = await service.createOrReuseConversation('user-a', {
    participantId: 'user-b',
  });
  expect(conversationModel.create).toHaveBeenCalledWith(
    expect.objectContaining({
      participantIds: ['user-a', 'user-b'],
      participantKey: 'user-a:user-b',
      listingId: DIRECT_CONVERSATION_LISTING_ID,
    }),
  );
});

it('returns an existing conversation instead of creating a duplicate', async () => {
  conversationModel.findOne.mockReturnValueOnce(queryReturning(existingConversation));
  await service.createOrReuseConversation('user-a', { participantId: 'user-b' });
  expect(conversationModel.create).not.toHaveBeenCalled();
});

it('rejects self-chat and hides a conversation from non-participants', async () => {
  await expect(service.createOrReuseConversation('user-a', { participantId: 'user-a' })).rejects.toThrow();
  conversationModel.findOne.mockReturnValueOnce(queryReturning(null));
  await expect(service.getParticipantOrThrow('conversation-id', 'user-c')).rejects.toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --runInBand test/chat/chat-conversation.service.spec.ts`

Expected: FAIL because the service and DTOs do not exist.

- [ ] **Step 3: Implement DTO validation**

Require a non-empty `participantId`. Make `listing` optional and validate its nested fields; require `listing.id` when the object exists. Bound strings to the sizes needed by the UI and allow only an HTTP(S) image URL.

- [ ] **Step 4: Implement create/reuse and listing**

Build the participant key, query by `participantKey` and normalized `listingId`, create when absent, and catch duplicate-key races by re-reading the existing document. For listing, query `{ participantIds: currentUserId }`, sort `updatedAt` descending, apply a bounded limit, and map the other participant plus unread count into `ConversationView`.

- [ ] **Step 5: Implement participant authorization**

Query by both `_id` and `participantIds: currentUserId`; throw `NotFoundException` when no document matches. Reuse this method from every message operation.

- [ ] **Step 6: Run the focused test**

Run: `npm test -- --runInBand test/chat/chat-conversation.service.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/chat/application test/chat/chat-conversation.service.spec.ts
git commit -m "feat(chat): manage conversations"
```

### Task 4: Implement message send, history, unread counts, and mark-read

**Files:**
- Create: `src/modules/chat/application/dto/send-message.dto.ts`
- Create: `src/modules/chat/application/dto/list-messages.dto.ts`
- Create: `src/modules/chat/application/chat-message.service.ts`
- Modify: `src/modules/chat/application/chat-conversation.service.ts`
- Test: `test/chat/chat-message.service.spec.ts`

**Interfaces:**
- `sendMessage(currentUserId: string, conversationId: string, input: SendMessageDto): Promise<MessageView>`.
- `listMessages(currentUserId: string, conversationId: string, query: ListMessagesDto): Promise<MessagePage>`.
- `markRead(currentUserId: string, conversationId: string): Promise<ConversationView>`.

- [ ] **Step 1: Write failing message tests**

```ts
it('stores the gateway user as sender and updates the conversation preview', async () => {
  const result = await service.sendMessage('user-a', 'conversation-id', {
    content: '  Chào bạn  ',
  });
  expect(messageModel.create).toHaveBeenCalledWith(
    expect.objectContaining({ senderId: 'user-a', content: 'Chào bạn' }),
  );
  expect(conversationModel.updateOne).toHaveBeenCalledWith(
    { _id: 'conversation-id', participantIds: 'user-a' },
    expect.objectContaining({ $inc: { 'unreadCounts.user-b': 1 } }),
  );
  expect(result.senderId).toBe('user-a');
});

it('rejects empty content and blocks non-participants', async () => {
  await expect(service.sendMessage('user-a', 'conversation-id', { content: '  ' })).rejects.toThrow();
  conversationService.getParticipantOrThrow.mockRejectedValueOnce(new NotFoundException());
  await expect(service.listMessages('user-c', 'conversation-id', {})).rejects.toThrow(NotFoundException);
});

it('resets only the current user unread count', async () => {
  await service.markRead('user-a', 'conversation-id');
  expect(conversationModel.updateOne).toHaveBeenCalledWith(
    { _id: 'conversation-id', participantIds: 'user-a' },
    { $set: { 'unreadCounts.user-a': 0 } },
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --runInBand test/chat/chat-message.service.spec.ts`

Expected: FAIL because message services and DTOs do not exist.

- [ ] **Step 3: Implement DTOs and message persistence**

Require trimmed `content` with a bounded maximum length. Accept the same optional validated listing snapshot. On send, call `getParticipantOrThrow`, create the message with `senderId` from the method argument, update last-message fields and the other participant's unread counter, and return the mapped message.

- [ ] **Step 4: Implement history pagination**

Query by `conversationId` after authorization, optionally add `createdAt: { $lt: before }`, sort `createdAt: -1`, limit to a bounded maximum, reverse the result, and return `{ items, nextBefore }`.

- [ ] **Step 5: Implement mark-read**

Authorize first, then update only `unreadCounts.<currentUserId>` to zero. Do not reset the other participant's count.

- [ ] **Step 6: Run focused tests and build**

Run: `npm test -- --runInBand test/chat/chat-message.service.spec.ts` and `npm run build`

Expected: PASS and build exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/chat/application test/chat/chat-message.service.spec.ts
git commit -m "feat(chat): send and read messages"
```

### Task 5: Expose authenticated REST controllers

**Files:**
- Create: `src/modules/chat/presentation/chat.controller.ts`
- Modify: `src/modules/chat/chat.module.ts`
- Test: `test/chat/chat.controller.spec.ts`

**Interfaces:**
- `GET /conversations?limit=30`
- `POST /conversations`
- `GET /conversations/:conversationId/messages?limit=50&before=<ISO timestamp>`
- `POST /conversations/:conversationId/messages`
- `PATCH /conversations/:conversationId/read`

- [ ] **Step 1: Write controller tests**

Mock `ChatConversationService` and `ChatMessageService`. Assert every route uses `@UseGuards(GatewayAuthenticationGuard)`, passes `CurrentUser().userId` to the application service, and returns `new ApiResponseDto({ result })` with `code: 1000`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --runInBand test/chat/chat.controller.spec.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement the controller**

Use `@Controller('conversations')`. Keep route handlers thin: parse DTOs through the existing global `ValidationPipe`, obtain `UserContext` through `@CurrentUser()`, delegate to the services, and wrap every result in `ApiResponseDto`.

- [ ] **Step 4: Register providers/controllers and preserve existing modules**

Add the two application services and controller to `ChatModule`; export no chat provider outside the module.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- --runInBand test/chat/chat.controller.spec.ts`, `npm run test:e2e`, and `npm run build`

Expected: all focused/current e2e tests PASS and build exits 0. Modify `test/app.e2e-spec.ts` to register `ChatController`, `ChatConversationService`, and `ChatMessageService` with mocks, then verify one authenticated list request and one unauthenticated request.

- [ ] **Step 6: Commit**

```bash
git add src/modules/chat test/chat/chat.controller.spec.ts
git commit -m "feat(chat): expose authenticated REST API"
```

### Task 6: Update service documentation and verify gateway contract

**Files:**
- Modify: `README.md`

**Interfaces:**
- Local API base: `http://localhost:8082`.
- Gateway API base: `http://localhost:8080/api/v1/chat`.

- [ ] **Step 1: Add the REST contract to README**

Document MongoDB database expectations, the five endpoints, required gateway identity, sample create/send requests, and the local command to drop the standalone database before testing.

- [ ] **Step 2: Run a contract smoke test**

With MongoDB, Eureka, and Gateway available, call `GET /api/v1/chat/ping`, then call the authenticated conversation endpoint with the same `X-User-*` headers used by the existing e2e test. Verify the gateway rewrites the path and the chat service receives the identity. The existing gateway route and security catch-all remain unchanged.

- [ ] **Step 3: Run service checks**

Run: `npm test`, `npm run lint`, and `npm run build`.

Expected: chat tests and build pass. Record unrelated pre-existing lint failures separately instead of broad refactoring.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(chat): document REST API"
```

### Task 7: Replace the web mock provider with the chat API adapter

**Files:**
- Create: `../hs-web-app/services/chat.service.ts`
- Create or modify: `../hs-web-app/types/chat-api.type.ts`
- Modify: `../hs-web-app/components/chat/ChatDemoProvider.tsx`
- Modify: `../hs-web-app/app/chat/page.tsx`
- Modify: `../hs-web-app/components/rent/RentDetailView.tsx`
- Test: `../hs-web-app/lib/chat-api-mapper.test.ts`

**Interfaces:**
- `chatService.listConversations(limit?: number)`.
- `chatService.createConversation(participantId: string, listing?: RelatedListing)`.
- `chatService.listMessages(conversationId: string, before?: string)`.
- `chatService.sendMessage(conversationId: string, content: string, listing?: RelatedListing)`.
- `chatService.markRead(conversationId: string)`.

- [ ] **Step 1: Write mapper tests**

Test conversion from API dates/sender IDs to the current UI `ChatConversation` and `ChatMessage` shape, especially `sender: 'me' | 'them'`, last-message preview, unread count, and listing cards.

- [ ] **Step 2: Implement the thin Axios service and mapper**

Reuse `axiosClient` and the existing `ApiResponse` type. Do not add a second HTTP client or move UI state into a new global store.

- [ ] **Step 3: Switch provider actions to API calls**

Keep the current popup/full-page behavior and identity switcher. Load conversations on mount, load messages when a conversation opens, create/reuse a conversation from the listing CTA, send the content/listing payload, and mark read after opening.

- [ ] **Step 4: Remove only obsolete direct mock mutations**

Keep mock data only as a fallback/demo fixture until the API smoke test passes; remove the in-memory mutation path after the adapter is active. Keep AI chat on its existing local mock flow.

- [ ] **Step 5: Run web checks**

Run in `hs-web-app`: `npm run build`, targeted TypeScript check, and the existing chat state tests. Manually verify list-first popup, direct listing CTA, back-to-list, AI-first ordering, listing card persistence, and scroll-to-latest.

- [ ] **Step 6: Commit in the web repo**

```bash
git add services/chat.service.ts types/chat-api.type.ts components/chat/ChatDemoProvider.tsx app/chat/page.tsx components/rent/RentDetailView.tsx lib/chat-api-mapper.test.ts
git commit -m "feat(chat): connect web UI to chat REST API"
```
