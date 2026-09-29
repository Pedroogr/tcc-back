# Gesture Event Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept one validated, ephemeral first-hand snapshot from an owned auction's gesture station and relay it only to valid operators assigned to that auction.

**Architecture:** A focused gesture module validates multipart metadata and JPEG properties, then reserves the event in a bounded in-memory policy before publishing through the existing commerce gateway. The gateway owns a new operator-only auction room and binary event contract. No database model, file write, history, or replay is introduced.

**Tech Stack:** NestJS 11, TypeScript, Multer memory uploads, `image-size`, Socket.IO, Jest, Supertest, PostgreSQL E2E fixtures.

**Spec:** `docs/superpowers/specs/2026-09-29-gesture-recognition-design.md`

## Global Constraints

- Endpoint: `POST /auctions/:auctionId/gesture-events`, authenticated with the existing auction-house JWT guard.
- Only the auction's owning `AUCTION_HOUSE` may submit; `FINISHED` and `CANCELED` auctions reject events.
- Accept only UUID `eventId`, ISO `capturedAt` within 30 seconds of server time, normalized `personBox`, and one JPEG snapshot.
- Accept `image/jpeg` only, at most 256 KiB, and dimensions no larger than 1280 by 720.
- Accept at most one event per auction in each five-second window.
- Retain at most 512 accepted event IDs for 60 seconds in memory; no database or filesystem persistence.
- Server calculates `expiresAt` as acceptance time plus five seconds.
- Emit `gesture:first-hand-detected` only to `auction:<auctionId>:operators`, with binary snapshot bytes.
- Operators may join that room only with a currently valid, used, unrevoked, unexpired token bound to the same nonterminal auction.
- Existing price, buyer, office, and user-room privacy behavior must remain unchanged.

## Review Focus

- Multipart fields may be missing, repeated, malformed JSON, `NaN`, or outside the image; Task 1 pins rejection without reserving an ID.
- A JPEG may advertise the correct MIME type while containing invalid bytes or oversized dimensions; Task 1 validates decoded metadata.
- Duplicate and rate-limited requests can race in one Node process; Task 1 keeps validation/reservation synchronous after the ownership query and tests stable duplicate/rate results.
- Buyer, office, unauthenticated, and wrong-auction sockets must never receive the binary event; Tasks 2 and 3 test room membership and cross-auction isolation.
- Socket serialization may change `Buffer` shape; Task 3 asserts the received payload reconstructs the exact submitted bytes rather than only checking an event name.

---

## File Structure

- `src/gesture/gesture-event-policy.ts`: constants, multipart parsing, JPEG validation, bounded idempotency, and per-auction rate window.
- `src/gesture/gesture-event-policy.spec.ts`: deterministic policy and boundary tests.
- `src/gesture/dto/create-gesture-event.dto.ts`: whitelist-compatible multipart text fields.
- `src/gesture/gesture-events.controller.ts`: authenticated multipart boundary and 202 response.
- `src/gesture/gesture-events.service.ts`: ownership/state check, policy reservation, payload construction, and publish orchestration.
- `src/gesture/gesture.module.ts`: gesture dependency boundary.
- `src/commerce/commerce-events.ts`: shared normalized box and first-hand event payload.
- `src/commerce/commerce.gateway.ts`: operator-only room join and publish method.
- `src/commerce/commerce.gateway.spec.ts`: room privacy and targeted publish unit tests.
- `src/app.module.ts`: registers `GestureModule`.
- `test/gesture-events.e2e-spec.ts`: real HTTP/socket authorization, validation, rate, idempotency, binary payload, and isolation coverage.
- `package.json` / `package-lock.json`: `image-size` runtime dependency.

---

### Task 1: Gesture Upload Policy

**Files:**
- Create: `src/gesture/gesture-event-policy.ts`
- Create: `src/gesture/gesture-event-policy.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `GESTURE_EVENT_DISPLAY_MS = 5_000`, `GESTURE_EVENT_CAPTURE_SKEW_MS = 30_000`, `GESTURE_EVENT_RATE_WINDOW_MS = 5_000`, `GESTURE_EVENT_ID_TTL_MS = 60_000`, `GESTURE_EVENT_ID_LIMIT = 512`, and `GESTURE_SNAPSHOT_MAX_BYTES = 256 * 1024`.
- Produces: `GestureEventUpload { eventId: string; capturedAt: string; personBox: string; snapshot?: GestureSnapshotUpload }` and `ValidatedGestureEvent { eventId: string; capturedAt: Date; personBox: GesturePersonBox; snapshot: Buffer }`.
- Produces: `GestureEventPolicy.validate(upload, now): ValidatedGestureEvent`, `reserve(auctionId, eventId, now): void`, and `clear(): void`.
- Consumes: `GesturePersonBox` from `src/commerce/commerce-events.ts`; create that type in this task so all later payloads share one definition.

- [ ] **Step 1: Install JPEG metadata support**

Run `npm.cmd install image-size`. Expected: `image-size` appears under runtime dependencies and lockfile resolves without a major-version override.

- [ ] **Step 2: Write failing policy tests**

Test a valid UUID, current ISO timestamp, `{"x":0.1,"y":0.2,"width":0.3,"height":0.4}`, and a real JPEG fixture. Assert parsed values and original bytes. Add table tests for missing snapshot, wrong MIME, invalid JPEG, more than 256 KiB, width 1281, height 721, invalid/old/future timestamps, malformed box JSON, nonnumeric fields, nonpositive dimensions, values outside `[0,1]`, and boxes whose right/bottom exceed `1`.

- [ ] **Step 3: Write failing reservation tests**

Assert the same accepted ID within 60 seconds throws `ConflictException`, a different ID for the same auction before 5,000 ms throws HTTP 429, another auction is independent, the auction reopens at exactly 5,000 ms, expired IDs are pruned, and inserting 513 IDs never retains more than 512. Expose `sizeForTesting()` only as package-visible method if the bound cannot be asserted through behavior.

- [ ] **Step 4: Verify RED**

Run `npm.cmd test -- --runInBand src/gesture/gesture-event-policy.spec.ts`. Expected: FAIL because the policy module does not exist.

- [ ] **Step 5: Implement validation and bounded reservation**

Use `imageSize(snapshot.buffer)` only after MIME and byte limits. `reserve` must synchronously prune, check duplicate, check the auction window, then record both entries so two calls in the same event-loop turn cannot both succeed. Public errors use stable Portuguese messages without internal parser details.

- [ ] **Step 6: Verify GREEN and commit**

Run `npm.cmd test -- --runInBand src/gesture/gesture-event-policy.spec.ts`, `npm.cmd run build`, `npm.cmd run lint -- --no-fix`, and `git diff --check`. Commit as `feat: validate ephemeral gesture events`.

---

### Task 2: Operator-Only Realtime Room

**Files:**
- Modify: `src/commerce/commerce-events.ts`
- Modify: `src/commerce/commerce.gateway.ts`
- Modify: `src/commerce/commerce.gateway.spec.ts`

**Interfaces:**
- Consumes: `GesturePersonBox` from Task 1.
- Produces: `GestureFirstHandDetectedPayload { eventId; auctionId; capturedAt: Date; expiresAt: Date; personBox; snapshotMimeType: 'image/jpeg'; snapshot: Buffer }`.
- Produces: `CommerceGateway.emitGestureFirstHandDetected(auctionId, payload): void` targeting only `auction:<auctionId>:operators`.
- Extends: authenticated `auction:join`; a valid operator bound to that auction joins both the price room and operator room, while all other actor types stay out of the operator room.

- [ ] **Step 1: Write failing gateway tests**

Add tests proving a valid operator joins `auction:auction-1:operators`, an operator bound elsewhere gets `commerce:error` and never joins, buyer/owner/non-owner sockets never join the operator room, and `emitGestureFirstHandDetected` emits the exact Buffer payload only through that room.

- [ ] **Step 2: Verify RED**

Run `npm.cmd test -- --runInBand src/commerce/commerce.gateway.spec.ts`. Expected: FAIL on missing operator-room membership and publish method.

- [ ] **Step 3: Implement room membership and publish contract**

Keep the existing authentication query and privacy branches. Add a private `operatorRoom(auctionId)` formatter and join it only inside the already-authorized `actor.type === 'OPERATOR'` path.

- [ ] **Step 4: Verify GREEN and commit**

Run the gateway spec, full unit suite, build, lint without fixes, and `git diff --check`. Commit as `feat: add operator gesture event room`.

---

### Task 3: Authenticated HTTP Relay

**Files:**
- Create: `src/gesture/dto/create-gesture-event.dto.ts`
- Create: `src/gesture/gesture-events.controller.ts`
- Create: `src/gesture/gesture-events.service.ts`
- Create: `src/gesture/gesture.module.ts`
- Create: `test/gesture-events.e2e-spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `GestureEventPolicy.validate/reserve` and `CommerceGateway.emitGestureFirstHandDetected`.
- Produces: `GestureEventsService.relay(auctionId, fields, snapshot, actor, now = new Date()): Promise<{ eventId: string; expiresAt: Date }>`.
- Produces: `POST /auctions/:auctionId/gesture-events`, multipart field name `snapshot`, HTTP 202 response `{ eventId, expiresAt }`.

- [ ] **Step 1: Write failing authorization/state E2E tests**

Assert 401 without a token; 403 for a user and another office; 404 for a missing auction; 400 for `FINISHED` and `CANCELED`; and 202 for the owner on a nonterminal auction. Use a real JPEG fixture and `.field(...)`/`.attach('snapshot', ...)`.

- [ ] **Step 2: Write failing validation/idempotency/rate E2E tests**

Assert stable 400/413 results for missing/invalid fields, MIME, bytes, and dimensions; 409 for a repeated accepted UUID; 429 for a second UUID inside five seconds; and no gateway event for every rejected request.

- [ ] **Step 3: Write failing binary relay/isolation E2E test**

Connect an assigned operator, a different-auction operator, buyer, and owner-office socket. Join each auction, submit one accepted image, and assert only the assigned operator receives `gesture:first-hand-detected`; `expiresAt - acceptedAt` is five seconds within test tolerance and reconstructed bytes equal the upload.

- [ ] **Step 4: Verify RED**

Run `npm.cmd run test:e2e -- test/gesture-events.e2e-spec.ts`. Expected: FAIL because the route and module do not exist.

- [ ] **Step 5: Implement controller, service, and module**

Use `ActorJwtAuthGuard`, `FileInterceptor('snapshot', { limits: { fileSize: 256 * 1024, files: 1 } })`, and a DTO containing only `eventId`, `capturedAt`, and `personBox` strings. Query only `{ id, auctionHouseId, status }`; check actor type/ownership/state before validation and reservation; create the server expiry; publish; return metadata only.

- [ ] **Step 6: Verify GREEN and no persistence**

Run the focused E2E file, full unit suite, build, lint without fixes, and `git diff --check`. Confirm `git diff --name-only` contains no Prisma schema, migration, upload-directory, or generated-client changes.

- [ ] **Step 7: Commit**

Commit as `feat: relay first-hand gesture snapshots`.

---

### Task 4: Backend Delivery Verification

**Files:**
- Inspect only: all files changed by Tasks 1–3.

**Interfaces:**
- Consumes: the complete backend relay.
- Produces: a clean backend commit series ready for the frontend Gesture Station.

- [ ] **Step 1: Run complete verification**

Run `npm.cmd test -- --runInBand`, `npm.cmd run test:e2e -- test/gesture-events.e2e-spec.ts test/websocket-gateways.e2e-spec.ts`, `npm.cmd run build`, `npm.cmd run lint -- --no-fix`, and `git diff origin/main...HEAD --check`.

- [ ] **Step 2: Review scope and security**

Confirm accepted bytes are referenced only by the immediate Socket.IO payload, errors do not expose actor or parser internals, all maps are bounded/pruned, and only the operator room receives the event.

- [ ] **Step 3: Push only after every check succeeds**

Fetch `origin`, require zero remote-only commits, then push `HEAD:main`. Do not start the frontend station until the backend push succeeds.
