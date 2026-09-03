# Chat Backend Design

## Goal

Turn the existing chat UI prototype into a standalone REST backend in
`hs-chat-service`. The first backend phase supports two authenticated users
exchanging messages and attaching a snapshot of a rental listing. Realtime,
tenant/landlord authorization, AI chat persistence, attachments, pinning, and
hiding conversations are out of scope.

## Architecture

`hs-chat-service` owns its MongoDB database and exposes the chat API through
the existing API Gateway route `/api/v1/chat/**`. The gateway continues to
validate JWTs and forwards the authenticated identity in `X-User-*` headers;
the chat service reuses `GatewayAuthenticationGuard` and never accepts a
client-supplied sender identity.

The service adds one `ChatModule` containing controllers, DTOs, Mongoose
schemas, and the application service. Existing configuration, health,
Eureka, response wrapper, validation pipe, and exception filter remain in
place. No new runtime dependency is needed because Mongoose is already
installed.

## Data model

### Conversation

- `participantIds: string[]`: exactly two user IDs, sorted for stable lookup.
- `participantKey: string`: the two sorted IDs joined with `:`.
- `listingId?: string`: optional related listing ID.
- `listing?: RelatedListingSnapshot`: optional display snapshot.
- `lastMessage?: string` and `lastMessageAt?: Date`.
- `lastMessageSenderId?: string`.
- `unreadCounts: Record<string, number>` keyed by participant ID.
- `createdAt` and `updatedAt`.

Create a unique index on `(participantKey, listingId)` so repeated clicks on
the same listing reuse the conversation. A conversation without a listing
uses a stable sentinel value for the index.

### Message

- `conversationId: ObjectId`.
- `senderId: string` from the authenticated gateway context.
- `content: string`, stored as Markdown/plain text without server-side HTML
  rendering.
- `listing?: RelatedListingSnapshot`.
- `createdAt: Date`.

Index messages by `(conversationId, createdAt)` and conversations by
`participantIds`/`updatedAt`. Listing snapshots contain only the fields the UI
already renders: ID, title, price, location, image, bedrooms, area, and
verified status. The listing service remains the source of truth; the snapshot
is only for chat history display.

## REST API

The local controller paths omit the gateway prefix. Through the gateway they
are `/api/v1/chat/...`.

### List conversations

`GET /conversations?limit=30`

Returns the authenticated user's conversations ordered by latest activity,
including the other participant, listing snapshot, last message, and unread
count. `limit` is bounded by the service.

### Create or reuse a conversation

`POST /conversations`

Request:

```json
{
  "participantId": "user-owner-123",
  "listing": {
    "id": "listing-123",
    "title": "Căn hộ 2PN",
    "price": "16.500.000 đ/tháng",
    "location": "Bình Thạnh",
    "image": "https://example.com/image.jpg",
    "bedrooms": 2,
    "area": 75,
    "verified": true
  }
}
```

The service rejects self-conversations and returns the existing conversation
when the same participant pair and listing already exist.

If a listing snapshot is provided, `listing.id` is required. Without a
listing, the conversation is unique to the participant pair.

### Read messages

`GET /conversations/:conversationId/messages?limit=50&before=<ISO timestamp>`

Only participants can read. Messages are returned oldest-to-newest within the
requested page so the UI can render directly. `before` is optional and keeps
the first implementation ready for history pagination without adding a second
API shape later.

### Send a message

`POST /conversations/:conversationId/messages`

Request:

```json
{
  "content": "Chào anh, căn này còn trống không ạ?",
  "listing": {
    "id": "listing-123",
    "title": "Căn hộ 2PN",
    "price": "16.500.000 đ/tháng",
    "location": "Bình Thạnh",
    "image": "https://example.com/image.jpg"
  }
}
```

The service validates and trims content, creates the message with the gateway
user as sender, updates the conversation preview, and increments the other
participant's unread count. Empty messages are rejected.

### Mark read

`PATCH /conversations/:conversationId/read`

The authenticated user's unread count is reset to zero. Only participants can
call this endpoint.

All successful endpoints use the existing `{ code: 1000, result }` response
shape. Invalid input returns 400, missing gateway identity returns 401, and a
non-participant receives 404 to avoid revealing another user's conversation;
it must never receive another user's messages.

## Data flow

1. The web app calls the gateway with its existing Axios client.
2. Gateway JWT validation produces `X-User-Id` and related identity headers.
3. Gateway rewrites `/api/v1/chat/...` to the local chat controller path.
4. The guard builds `UserContext` from those headers.
5. The chat application service authorizes by `participantIds`, persists the
   message/conversation in MongoDB, and returns the standard API response.
6. The web app replaces the demo provider with a small chat API service; UI
   behavior stays unchanged.

## Testing and rollout

- Unit-test participant key generation, self-chat rejection, authorization,
  unread updates, and message validation.
- Add controller/application tests for list, create/reuse, read, send, and
  mark-read flows using mocked Mongoose models.
- Keep the current health and gateway-identity e2e tests passing.
- Build and run the service tests before wiring the web app.
- Drop the standalone chat MongoDB database during local setup as agreed; no
  migration is required for the prototype data.
- Add the web API adapter only after the backend contract tests pass. Realtime
  transport can be added later without changing the conversation/message
  ownership model.
