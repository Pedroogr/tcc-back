# Buyer IE and Operator Bidding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require IE for buyers and add a mobile operator application that safely records on-site bids against the authoritative lot in the ring.

**Architecture:** The backend remains the source of truth: a shared transactional bid service accepts online and on-site commands, while a scoped `OperatorAccess` exchanges a one-use code for a revocable JWT. The commerce gateway publishes committed lot-stage changes, and both regular clients and the isolated `/operator` frontend reconcile through HTTP so a stale screen cannot place a bid on the wrong lot.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 16, Socket.IO 4, Jest/Supertest, React 19, TypeScript 6, Vite 8, Tailwind CSS 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-22-buyer-ie-operator-bidding-design.md`

## Global Constraints

- Use `operator` in code, database names, TypeScript types, HTTP paths, and JWT actor types; “Pisteiro” is UI copy only.
- Buyer payloads use exactly `buyerProfile: { ie, ieUf }`.
- IE supports digits only after normalization; `ieUf` must be a valid uppercase Brazilian UF.
- No `ISENTO`, non-contributor, or SEFAZ integration in this delivery.
- An operator code belongs to one auction, is shown once, activates once, lasts at most 24 hours, and is independently revocable.
- Multiple operator accesses may be active for one auction, but a code is never shared across devices.
- The operator sees name plus the final four CPF/CNPJ digits, never full document or contact details.
- Every on-site bid carries `expectedLotId`; the database transaction rejects a stale lot.
- Offline clients never queue bids.
- Database migrations never delete existing buyers; local test-buyer cleanup is an explicit, separately verified operation.

## Review Focus

- A formatted IE containing punctuation must normalize to digits, while blank or nonnumeric-only input must fail before persistence; Task 1 pins both cases.
- An approval raced with a profile losing IE must fail at review time, and a previously approved legacy buyer without IE must still fail at bid time; Tasks 2 and 3 pin both boundaries.
- Reusing one operator code from two devices must yield exactly one session, without revealing whether another attempt failed because it was used, revoked, or expired; Task 4 pins atomic activation and uniform errors.
- A lot change racing an on-site bid must reject the bid and store no row, even if the operator UI still displays the old lot; Task 5 pins the transaction boundary.
- A dropped Socket.IO event or reconnect must converge to the HTTP snapshot and must clear a partially filled bid form when the lot identity changes; Tasks 6 and 9 pin recovery.

---

### Task 1: Persist and require buyer IE

**Files:**
- Modify: `tcc-back/prisma/schema.prisma`
- Create: `tcc-back/prisma/migrations/20260922120000_add_buyer_ie/migration.sql`
- Create: `tcc-back/src/users/dto/upsert-buyer-profile.dto.ts`
- Modify: `tcc-back/src/users/dto/create-user.dto.ts`
- Modify: `tcc-back/src/users/users.controller.ts`
- Modify: `tcc-back/src/users/users.service.ts`
- Modify: `tcc-back/src/common/br-fields.ts`
- Modify: `tcc-back/test/auth.e2e-spec.ts`
- Modify: `tcc-back/test/users.e2e-spec.ts`

**Interfaces:**
- Produces: `UpsertBuyerProfileDto { ie: string; ieUf: string }`.
- Produces: `normalizeStateRegistration(value: string): string` and `normalizeBrazilianUf(value: string): string`.
- Produces: `BuyerProfile.ie` and `BuyerProfile.ieUf`, both nullable only for migration compatibility.

- [ ] **Step 1: Write failing registration and profile tests**

Add E2E cases that post a `BUYER` with no profile, blank IE, invalid UF, and a formatted valid IE. The successful assertion must be concrete:

```ts
expect(response.status).toBe(201);
expect(response.body.buyerProfile).toMatchObject({
  ie: '110042490114',
  ieUf: 'SP',
});
```

Also post `buyerProfile: { ie: 'abc', ieUf: 'SP' }` and expect `400`, proving that normalization cannot turn nonnumeric input into an accepted empty value.

- [ ] **Step 2: Run the focused tests and verify the red state**

Run in `tcc-back`: `npm run test:e2e -- --runInBand test/auth.e2e-spec.ts test/users.e2e-spec.ts`

Expected: FAIL because `buyerProfile` is currently rejected by the validation pipe or ignored and the returned profile has no IE.

- [ ] **Step 3: Add the schema fields and migration**

Extend the Prisma model without destructive SQL:

```prisma
model BuyerProfile {
  // existing fields
  ie   String?
  ieUf String?
}
```

The migration must contain only the two nullable columns:

```sql
ALTER TABLE "BuyerProfile"
ADD COLUMN "ie" TEXT,
ADD COLUMN "ieUf" TEXT;
```

Run: `npx prisma generate`

- [ ] **Step 4: Add DTO validation and normalization**

Create the nested DTO and make it required when `accountType === BUYER` in `UsersService.toUserCreateData`:

```ts
export class UpsertBuyerProfileDto {
  @IsString()
  @IsNotEmpty()
  ie!: string;

  @IsString()
  @IsNotEmpty()
  ieUf!: string;
}
```

Implement normalization with the complete UF set and reject an empty normalized IE:

```ts
const BRAZILIAN_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]);

export function normalizeStateRegistration(value: string) {
  const ie = onlyDigits(value);
  if (!ie) throw new BadRequestException('Inscricao estadual obrigatoria.');
  return ie;
}
```

Update both registration and `POST /users/me/buyer-profile` to accept the same DTO. A `BUYER` without the nested object must throw `BadRequestException`; seller creation remains unchanged.

- [ ] **Step 5: Run focused and regression tests**

Run: `npm run test:e2e -- --runInBand test/auth.e2e-spec.ts test/users.e2e-spec.ts`

Expected: PASS, including formatted IE normalization, invalid UF, blank/non-numeric IE, missing buyer profile, and unaffected seller registration.

- [ ] **Step 6: Commit the buyer contract**

```bash
git add prisma/schema.prisma prisma/migrations src/common/br-fields.ts src/users test/auth.e2e-spec.ts test/users.e2e-spec.ts
git commit -m "feat: require state registration for buyers"
```

---

### Task 2: Enforce IE at office review and buyer registration boundaries

**Files:**
- Modify: `tcc-back/src/auctions/auctions.service.ts`
- Modify: `tcc-back/src/auction-houses/auction-houses.service.ts`
- Modify: `tcc-back/test/support/factories.ts`
- Modify: `tcc-back/test/auctions.e2e-spec.ts`
- Modify: `tcc-back/test/auction-houses.e2e-spec.ts`

**Interfaces:**
- Consumes: `BuyerProfile.ie` and `BuyerProfile.ieUf` from Task 1.
- Produces: office registration responses whose `buyer.buyerProfile` contains IE and UF.
- Produces: the invariant that `APPROVED` can only be assigned to a buyer with both fields.

- [ ] **Step 1: Add failing boundary tests**

Create a legacy buyer profile with `{ ie: null, ieUf: null }`. Assert that requesting approval and changing a registration to `APPROVED` both return `400`. Assert that a valid buyer is listed with:

```ts
expect(listed.body[0].buyer.buyerProfile).toMatchObject({
  ie: '224365879',
  ieUf: 'RS',
});
```

The race test must create a pending valid registration, null the profile fields directly, then attempt approval and expect no `approvedAt` value in the database.

- [ ] **Step 2: Run the auction registration tests and verify failure**

Run: `npm run test:e2e -- --runInBand test/auctions.e2e-spec.ts test/auction-houses.e2e-spec.ts`

Expected: FAIL because approval currently checks only the registration and office ownership.

- [ ] **Step 3: Enforce the profile invariant in both route families**

Before creating a buyer registration, load the current buyer profile. Before an `APPROVED` review, load the registration with `buyer.buyerProfile`. Reuse a focused helper:

```ts
private assertBuyerHasIe(profile: { ie: string | null; ieUf: string | null } | null) {
  if (!profile?.ie || !profile.ieUf) {
    throw new BadRequestException(
      'Comprador precisa informar IE e UF antes da aprovacao.',
    );
  }
}
```

Apply the same rule in `AuctionsService` and the canonical routes in `AuctionHousesService`; do not allow one controller family to bypass it.

- [ ] **Step 4: Make buyer fixtures valid by default**

Change `createBuyer` to create `{ ie: '224365879', ieUf: 'RS' }`. Add optional overrides so individual tests can deliberately create legacy invalid profiles. Update bidding fixtures that use `createUser` directly to attach a valid `BuyerProfile` whenever they represent a buyer.

- [ ] **Step 5: Run the focused tests**

Run: `npm run test:e2e -- --runInBand test/auctions.e2e-spec.ts test/auction-houses.e2e-spec.ts test/bidding.e2e-spec.ts`

Expected: PASS; invalid legacy profiles remain rejected and existing valid bidding scenarios still work.

- [ ] **Step 6: Commit the approval invariant**

```bash
git add src/auctions src/auction-houses test/support/factories.ts test/auctions.e2e-spec.ts test/auction-houses.e2e-spec.ts test/bidding.e2e-spec.ts
git commit -m "feat: enforce buyer IE before approval"
```

---

### Task 3: Add bid origin and a shared transactional bid service

**Files:**
- Modify: `tcc-back/prisma/schema.prisma`
- Create: `tcc-back/prisma/migrations/20260922130000_add_operator_bid_audit/migration.sql`
- Create: `tcc-back/src/lots/bids.service.ts`
- Modify: `tcc-back/src/lots/lots.service.ts`
- Modify: `tcc-back/src/lots/lots.module.ts`
- Modify: `tcc-back/src/commerce/commerce-events.ts`
- Modify: `tcc-back/test/bidding.e2e-spec.ts`
- Modify: `tcc-back/test/support/factories.ts`

**Interfaces:**
- Produces: `BidSource = ONLINE | ON_SITE` and nullable `Bid.operatorAccessId`.
- Produces: `BidsService.place(command: PlaceBidCommand): Promise<PublicBid>`.
- Produces: `PlaceBidCommand` discriminated by `source`; `ON_SITE` requires `operatorAccessId`, `auctionId`, `lotId`, `bidderId`, and `amount`.
- Produces: office bid history and `OfficeBidPayload` with `source`.

- [ ] **Step 1: Add failing source and missing-IE bid tests**

Assert that the existing online endpoint stores `source: 'ONLINE'` and returns no operator audit fields. Create an approved legacy buyer without IE and assert its bid returns `403` and stores zero bids.

- [ ] **Step 2: Run the focused bidding tests**

Run: `npm run test:e2e -- --runInBand test/bidding.e2e-spec.ts`

Expected: FAIL because `Bid.source` does not exist and legacy approved buyers are currently accepted.

- [ ] **Step 3: Add the audit schema**

Add the enum and relations in one migration:

```prisma
enum BidSource {
  ONLINE
  ON_SITE
}

model OperatorAccess {
  id         String   @id @default(uuid())
  label      String
  codeHash   String   @unique
  expiresAt  DateTime
  usedAt     DateTime?
  revokedAt  DateTime?
  auctionId  String
  auction    Auction  @relation(fields: [auctionId], references: [id], onDelete: Cascade)
  bids       Bid[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([auctionId])
  @@index([expiresAt])
}

model Bid {
  source           BidSource       @default(ONLINE)
  operatorAccessId String?
  operatorAccess   OperatorAccess? @relation(fields: [operatorAccessId], references: [id], onDelete: SetNull)
}
```

Add `operatorAccesses OperatorAccess[]` to `Auction`, write explicit SQL with the default for existing bids, and run `npx prisma generate`.

- [ ] **Step 4: Extract the shared service without changing online behavior**

Move the serializable retry loop, minimum/increment checks, registration lookup, previous-winner update, bid creation, and post-commit events from `LotsService.createBid` into `BidsService.place`.

Use this command contract:

```ts
export type PlaceBidCommand =
  | {
      source: BidSource.ONLINE;
      lotId: string;
      bidderId: string;
      amount: number;
    }
  | {
      source: BidSource.ON_SITE;
      auctionId: string;
      lotId: string;
      bidderId: string;
      operatorAccessId: string;
      amount: number;
    };
```

`LotsService.createBid` keeps actor validation, then delegates with `ONLINE`. The transaction always checks the buyer's current approved registration and nonempty IE/UF. Include `source` in persisted rows, office history, and office events, while the public bid response remains identity-free.

- [ ] **Step 5: Run unit, bidding, and commerce tests**

Run: `npm test -- --runInBand`

Run: `npm run test:e2e -- --runInBand test/bidding.e2e-spec.ts`

Expected: PASS, including one winner under concurrent online bids and `source: ONLINE` in office-only data.

- [ ] **Step 6: Commit the shared bid core**

```bash
git add prisma/schema.prisma prisma/migrations src/lots src/commerce/commerce-events.ts test
git commit -m "feat: audit bid source through shared service"
```

---

### Task 4: Create one-use operator access and revocable sessions

**Files:**
- Create: `tcc-back/src/operator/dto/create-operator-access.dto.ts`
- Create: `tcc-back/src/operator/dto/operator-login.dto.ts`
- Create: `tcc-back/src/operator/operator-auth.guard.ts`
- Create: `tcc-back/src/operator/operator-code.ts`
- Create: `tcc-back/src/operator/operator-login-rate-limiter.ts`
- Create: `tcc-back/src/operator/operator.controller.ts`
- Create: `tcc-back/src/operator/operator.service.ts`
- Create: `tcc-back/src/operator/operator.module.ts`
- Modify: `tcc-back/src/app.module.ts`
- Create: `tcc-back/test/operator-access.e2e-spec.ts`

**Interfaces:**
- Consumes: `OperatorAccess` from Task 3 and the global `JwtService`.
- Produces: `OperatorSessionActor { type: 'OPERATOR'; operatorAccess: { id; auctionId; label; expiresAt } }`.
- Produces: `POST/GET/DELETE /operator/accesses`, `POST /operator/login`, and `GET /operator/session`.
- Produces: code helpers `generateOperatorCode()`, `normalizeOperatorCode()`, and `hashOperatorCode()`.

- [ ] **Step 1: Write failing access lifecycle tests**

Cover owner-only creation, list redaction, foreign-office rejection, two active accesses for one auction, atomic one-use login, 24-hour ceiling, finished-auction rejection, revocation of an already issued token, expiry, and uniform login errors. Assert creation returns a display code matching `XXXX-XXXX-XXXX`, while subsequent lists contain neither `code` nor `codeHash`.

Add a rate-limit case: after five invalid attempts for the same request IP inside one minute, the sixth returns `429`; advancing or resetting the limiter window allows a later attempt.

- [ ] **Step 2: Run the new E2E file and verify failure**

Run: `npm run test:e2e -- --runInBand test/operator-access.e2e-spec.ts`

Expected: FAIL with missing `/operator` routes.

- [ ] **Step 3: Implement code creation and access management**

Generate six random bytes and display twelve uppercase hex characters in three groups. Normalize by removing separators and uppercase before hashing. Hash with HMAC-SHA-256 using `OPERATOR_CODE_PEPPER`, falling back to `JWT_SECRET` only in development/test; compare normalized hashes, never plaintext.

`createAccess(auctionId, label, officeId)` must verify ownership and an auction that is not `FINISHED` or `CANCELED`, then store `expiresAt = now + 24h`. Return the raw display code only from this call. `revokeAccess` writes `revokedAt` instead of deleting.

- [ ] **Step 4: Implement atomic login and the operator guard**

Login looks up the hash, verifies time/revocation/auction state, and atomically claims it:

```ts
const claimed = await tx.operatorAccess.updateMany({
  where: { id: access.id, usedAt: null, revokedAt: null },
  data: { usedAt: now },
});
if (claimed.count !== 1) throw invalidOperatorCode();
```

Sign a JWT containing:

```ts
{
  sub: access.id,
  actorType: 'OPERATOR',
  operatorAccessId: access.id,
  auctionId: access.auctionId,
}
```

`OperatorAuthGuard` verifies the token and reloads `OperatorAccess` on every request, requiring `usedAt`, no `revokedAt`, future `expiresAt`, matching auction claim, and an auction not finished/canceled.

- [ ] **Step 5: Implement bounded in-memory login throttling**

`OperatorLoginRateLimiter` stores `{ failures, resetsAt }` by request IP, prunes expired entries on each attempt, clears an entry after successful login, and throws `TooManyRequestsException` after five failures in 60 seconds. Keep it module-scoped and document that it matches the current single-instance deployment.

- [ ] **Step 6: Run access tests and security regressions**

Run: `npm run test:e2e -- --runInBand test/operator-access.e2e-spec.ts test/auth.e2e-spec.ts`

Expected: PASS; a revoked token immediately fails `GET /operator/session`, and two simultaneous logins with one code yield one `200/201` and one `401`.

- [ ] **Step 7: Commit operator authentication**

```bash
git add src/operator src/app.module.ts test/operator-access.e2e-spec.ts
git commit -m "feat: add temporary operator access"
```

---

### Task 5: Search approved buyers and record on-site bids

**Files:**
- Create: `tcc-back/src/operator/dto/search-operator-buyers.dto.ts`
- Create: `tcc-back/src/operator/dto/create-operator-bid.dto.ts`
- Modify: `tcc-back/src/operator/operator.controller.ts`
- Modify: `tcc-back/src/operator/operator.service.ts`
- Modify: `tcc-back/src/lots/bids.service.ts`
- Create: `tcc-back/test/operator-bidding.e2e-spec.ts`

**Interfaces:**
- Consumes: `OperatorSessionActor` from Task 4 and `BidsService.place` from Task 3.
- Produces: `GET /operator/buyers?query=` returning `{ id, name, documentLast4 }[]`.
- Produces: `POST /operator/bids` accepting `{ expectedLotId, buyerId, amount }`.
- Produces: on-site bids with `source: ON_SITE` and `operatorAccessId`.

- [ ] **Step 1: Write failing search privacy tests**

Create approved, pending, rejected, other-office, and approved-without-IE buyers. Search by partial name and document. Assert only the eligible same-office buyer appears and the serialized response contains no `email`, `phone`, full `document`, or `ie`.

Also send whitespace-only and excessively long queries; expect a bounded recent-result list for blank input and `400` beyond the DTO maximum instead of an unbounded scan.

- [ ] **Step 2: Write failing on-site bid and race tests**

Cover success, `ON_SITE` audit, minimum increment, unapproved buyer, buyer whose IE is removed after search, revoked access, wrong auction, no lot in the ring, and stale `expectedLotId`. For the race, move the auction to lot B immediately before posting lot A and assert:

```ts
expect(response.status).toBe(409);
expect(await prisma.bid.count({ where: { lotId: lotA.id } })).toBe(0);
expect(await prisma.bid.count({ where: { lotId: lotB.id } })).toBe(0);
```

- [ ] **Step 3: Run the new operator bidding tests**

Run: `npm run test:e2e -- --runInBand test/operator-bidding.e2e-spec.ts`

Expected: FAIL because buyer search and on-site bid routes do not exist.

- [ ] **Step 4: Implement sanitized buyer search**

Resolve the office through `OperatorAccess.auction.auctionHouseId`. Query `BuyerRegistration` with `status: APPROVED`, nonnull/nonempty IE and UF, and case-insensitive name or normalized document matching. Select only `buyer.id`, `buyer.name`, and `buyer.document`, limit to 20, then map:

```ts
{
  id: buyer.id,
  name: buyer.name,
  documentLast4: buyer.document?.slice(-4) ?? null,
}
```

- [ ] **Step 5: Implement transactionally safe on-site placement**

Pass the guard-derived access and payload into `BidsService.place`. Inside the same serializable transaction that changes the winner, reload the access and authoritative `IN_AUCTION` lot for its auction. Throw `ConflictException('O lote em pista mudou. Atualize e tente novamente.')` unless it equals `expectedLotId`. Recheck registration, IE, and minimum immediately before the write.

- [ ] **Step 6: Run on-site, online, and concurrency tests**

Run: `npm run test:e2e -- --runInBand test/operator-bidding.e2e-spec.ts test/bidding.e2e-spec.ts`

Expected: PASS; concurrent operators still leave exactly one `WINNING` bid and all prior online behavior remains green.

- [ ] **Step 7: Commit operator bidding**

```bash
git add src/operator src/lots/bids.service.ts test/operator-bidding.e2e-spec.ts test/bidding.e2e-spec.ts
git commit -m "feat: record on-site bids through operators"
```

---

### Task 6: Publish and recover authoritative lot-stage changes

**Files:**
- Modify: `tcc-back/src/commerce/commerce-events.ts`
- Modify: `tcc-back/src/commerce/commerce.gateway.ts`
- Modify: `tcc-back/src/commerce/commerce.gateway.spec.ts`
- Modify: `tcc-back/src/lots/lots.service.ts`
- Modify: `tcc-back/test/websocket-gateways.e2e-spec.ts`
- Modify: `tcc-back/test/lots.e2e-spec.ts`

**Interfaces:**
- Consumes: operator JWT claims and access validity from Task 4.
- Produces: `LotStageChangedPayload { auctionId, lot: { id, code, title, status, currentPrice, nextMinimumBid } | null }`.
- Produces: `CommerceGateway.emitLotStageChanged(auctionId, payload)` after commit.
- Produces: operator socket authorization limited to the token's `auctionId`.

- [ ] **Step 1: Write failing gateway and post-commit tests**

Unit-test that `emitLotStageChanged` reaches price, buyer, and office rooms without personal data. E2E-test that a valid operator joins only its assigned auction, while another `auctionId` produces `commerce:error`. Spy on the gateway around a forced transaction failure and assert no stage event was published.

- [ ] **Step 2: Run commerce and lot tests**

Run: `npm test -- --runInBand src/commerce/commerce.gateway.spec.ts`

Run: `npm run test:e2e -- --runInBand test/lots.e2e-spec.ts test/websocket-gateways.e2e-spec.ts`

Expected: FAIL because there is no stage payload or operator socket actor.

- [ ] **Step 3: Add the stage event and operator socket actor**

Extend gateway token parsing with `actorType: 'OPERATOR'`. Resolve and validate `OperatorAccess` exactly as the HTTP guard does. Permit `auction:join` only when payload ID equals the access auction. Do not grant operator membership in the office room; add it only to the non-sensitive price/stage room.

Emit:

```ts
this.server
  .to(this.priceRoom(auctionId))
  .emit('lot:stage-changed', payload);
```

The common room is enough for public site, buyers, office, and operator; office-only bid identity remains isolated.

- [ ] **Step 4: Publish only after `setStage` commits**

Refactor `LotsService.setStage` so the retry loop returns the committed public lot, then call `emitLotStageChanged` outside the transaction. Build `nextMinimumBid` from the committed current price/initial price and `AuctionSettings.minBidIncrement`. When no lot is in `IN_AUCTION`, publish `lot: null`.

- [ ] **Step 5: Run backend realtime regression**

Run: `npm test -- --runInBand`

Run: `npm run test:e2e -- --runInBand test/lots.e2e-spec.ts test/websocket-gateways.e2e-spec.ts test/operator-bidding.e2e-spec.ts`

Expected: PASS and no identity fields in price/stage rooms.

- [ ] **Step 6: Commit realtime synchronization**

```bash
git add src/commerce src/lots/lots.service.ts test/lots.e2e-spec.ts test/websocket-gateways.e2e-spec.ts
git commit -m "feat: synchronize the authoritative auction lot"
```

---

### Task 7: Add buyer IE to registration and office review UI

**Files:**
- Modify: `tcc-front/src/types/user.ts`
- Modify: `tcc-front/src/pages/AuthPage.tsx`
- Modify: `tcc-front/src/App.tsx`
- Modify: `tcc-front/src/pages/auction-room/RoomSidePanel.tsx`
- Modify: `tcc-front/tests/auth-ui.spec.ts`
- Modify: `tcc-front/tests/auction-commerce.spec.ts`

**Interfaces:**
- Consumes: backend `buyerProfile: { ie, ieUf }` contract from Task 1.
- Produces: `BuyerProfile` and `CreateBuyerProfilePayload` TypeScript types.
- Produces: required buyer-only IE and UF fields and office-visible review data.

- [ ] **Step 1: Add failing Playwright coverage**

In registration mode select Comprador, assert “Inscrição estadual” and “UF da IE” are required, submit `110.042.490.114` and `SP`, and inspect the request JSON for:

```ts
buyerProfile: { ie: '110042490114', ieUf: 'SP' }
```

Switch to Vendedor and assert the buyer fields disappear without altering seller fields. In the office room fixture, assert the pending buyer displays `IE 224365879 · RS`.

- [ ] **Step 2: Run the UI tests and verify failure**

Run in `tcc-front`: `npm run test:e2e -- tests/auth-ui.spec.ts tests/auction-commerce.spec.ts`

Expected: FAIL because buyer profile fields and typed data do not exist.

- [ ] **Step 3: Add typed form state and payload construction**

Replace `buyerProfile?: unknown` with:

```ts
export type BuyerProfile = {
  id: string;
  userId: string;
  ie?: string | null;
  ieUf?: string | null;
  verificationStatus?: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Add `buyerProfileForm = { ie: '', ieUf: '' }` to `App`, normalize IE to digits and UF to uppercase in handlers, and include it only for `BUYER` registration. Render both inputs in `AuthPage` with `required`, `inputMode="numeric"`, and a UF selector or constrained two-character input.

- [ ] **Step 4: Show IE in office review**

Render IE and UF below the buyer identity in `RoomSidePanel`. Disable or omit approval when either value is absent, matching the backend rather than relying on UI validation alone.

- [ ] **Step 5: Run focused frontend tests**

Run: `npm run test:e2e -- tests/auth-ui.spec.ts tests/auction-commerce.spec.ts`

Expected: PASS for buyer payload, seller isolation, office display, and no legacy completion UI.

- [ ] **Step 6: Commit buyer IE UI**

```bash
git add src/types/user.ts src/pages/AuthPage.tsx src/pages/auction-room/RoomSidePanel.tsx src/App.tsx tests/auth-ui.spec.ts tests/auction-commerce.spec.ts
git commit -m "feat: collect buyer state registration"
```

---

### Task 8: Add office management for operator accesses

**Files:**
- Create: `tcc-front/src/types/operator.ts`
- Create: `tcc-front/src/api/operatorApi.ts`
- Create: `tcc-front/src/components/OperatorAccessPanel.tsx`
- Modify: `tcc-front/src/pages/AuctionRoomPage.tsx`
- Create: `tcc-front/tests/operator-access.spec.ts`

**Interfaces:**
- Consumes: office-authenticated access management routes from Task 4.
- Produces: `OperatorAccessSummary`, `CreatedOperatorAccess`, `createOperatorAccess`, `listOperatorAccesses`, and `revokeOperatorAccess`.
- Produces: a self-contained `OperatorAccessPanel({ auctionId })` that does not add more state to `App.tsx`.

- [ ] **Step 1: Write the failing office workflow test**

Mock the three access routes. Enter an office auction room, create “Pista principal”, assert the returned code is visible with a copy action, dismiss it, and assert a refresh shows only label/status/expiry. Revoke it and assert the UI marks it revoked. Verify no list response or rendered row contains `codeHash`.

- [ ] **Step 2: Run the new test and verify failure**

Run: `npm run test:e2e -- tests/operator-access.spec.ts`

Expected: FAIL because the access panel is absent.

- [ ] **Step 3: Add API types and calls**

Define:

```ts
export type OperatorAccessSummary = {
  id: string;
  auctionId: string;
  label: string;
  expiresAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
};

export type CreatedOperatorAccess = OperatorAccessSummary & { code: string };
```

Use the normal `apiRequest` because only the office manages these routes.

- [ ] **Step 4: Implement the isolated panel**

Keep list/loading/error/created-code state inside `OperatorAccessPanel`. Show the raw code only in the create-success dialog; closing the dialog discards it. Use `navigator.clipboard.writeText` with a controlled fallback message. Confirm revocation before `DELETE` and refresh the list afterward.

- [ ] **Step 5: Render only for the owner office and run the test**

Mount the panel in the `canManage` branch of `AuctionRoomPage`, passing the selected auction ID.

Run: `npm run test:e2e -- tests/operator-access.spec.ts`

Expected: PASS; buyer sessions never render access management.

- [ ] **Step 6: Commit access management UI**

```bash
git add src/types/operator.ts src/api/operatorApi.ts src/components/OperatorAccessPanel.tsx src/pages/AuctionRoomPage.tsx tests/operator-access.spec.ts
git commit -m "feat: manage operator access codes"
```

---

### Task 9: Build the isolated mobile operator application

**Files:**
- Modify: `tcc-front/src/main.tsx`
- Modify: `tcc-front/src/api/socket.ts`
- Modify: `tcc-front/src/api/operatorApi.ts`
- Modify: `tcc-front/src/types/operator.ts`
- Create: `tcc-front/src/operator/OperatorApp.tsx`
- Create: `tcc-front/src/operator/OperatorLoginPage.tsx`
- Create: `tcc-front/src/operator/OperatorBidPage.tsx`
- Create: `tcc-front/tests/operator-bidding.spec.ts`

**Interfaces:**
- Consumes: operator login/session/search/bid APIs and `lot:stage-changed` from Tasks 4–6.
- Produces: `/operator` route with storage key `cattleAuctionOperatorToken`.
- Produces: `createOperatorCommerceSocket(token: string)` without reading the normal application token.
- Produces: five-second HTTP reconciliation plus immediate refresh on connect/reconnect/stage event.

- [ ] **Step 1: Write failing login and storage-isolation tests**

Open `/operator`, submit `ABCD-EF12-3456`, and assert the normalized code is posted. Return an operator token and session fixture. Preload `cattleAuctionToken=buyer-token`; assert login writes only `cattleAuctionOperatorToken` and leaves the buyer token untouched. Invalid/used/expired responses must show one generic message.

- [ ] **Step 2: Write failing bid workflow and privacy tests**

Mock an active session with lot 2, buyer search, and bid creation. Assert the page has no video/transmission controls, renders `Lote 2`, current value and next minimum, displays `Maria Silva · final 1234`, requires a confirmation containing lot/buyer/value, then clears buyer and value after success.

Inspect rendered text and network fixtures to confirm no email, phone, full document, or IE appears.

- [ ] **Step 3: Run the operator UI tests and verify failure**

Run: `npm run test:e2e -- tests/operator-bidding.spec.ts`

Expected: FAIL because `/operator` still renders the main application.

- [ ] **Step 4: Add isolated API and route bootstrapping**

Add:

```ts
export const operatorStorage = {
  tokenKey: 'cattleAuctionOperatorToken',
};
```

Implement `operatorRequest` with only that token. In `main.tsx`, select `OperatorApp` for `/operator` before the normal `App`; keep the existing `/admin` behavior unchanged.

- [ ] **Step 5: Implement mobile-first login and bid flow**

`OperatorApp` owns token/session lifecycle. `OperatorLoginPage` accepts and formats the code. `OperatorBidPage` renders a single-column touch-friendly flow, debounces buyer search, parses a positive currency value, and opens an explicit confirmation dialog before POSTing:

```ts
await createOperatorBid({
  expectedLotId: session.currentLot.id,
  buyerId: selectedBuyer.id,
  amount: parsedAmount,
});
```

On success, clear `selectedBuyer` and `amount`, keep the current lot, and refresh the session so the displayed price matches persistence.

- [ ] **Step 6: Add connection state and authoritative reconciliation**

Create the operator socket with the explicit operator token. On connect/reconnect emit `auction:join`, set `syncing`, fetch `/operator/session`, then enable submission. Also refresh every five seconds and on `lot:stage-changed` or `bid:price-updated`.

When `previousLotId !== nextLotId`, clear buyer and amount. When offline, disconnected, syncing, or without a current lot, disable submission and never retain a deferred request. A `401` clears the operator token and returns to login; a stale-lot `409` refreshes, clears the form, and explains that the lot changed.

- [ ] **Step 7: Add race/reconnect/offline tests**

In Playwright, fill a bid for lot A, emit a stage event for lot B, and assert form reset. Drop the event, change the HTTP fixture to lot B, advance past the periodic refresh, and assert convergence. Set the context offline and assert no POST occurs. Return `409` and assert the new lot is fetched before another submission is allowed.

- [ ] **Step 8: Run operator tests**

Run: `npm run test:e2e -- tests/operator-bidding.spec.ts tests/operator-access.spec.ts`

Expected: PASS for code login, storage isolation, privacy, confirmation, form clearing, realtime change, missed-event recovery, stale-lot response, revocation, and offline blocking.

- [ ] **Step 9: Commit the operator application**

```bash
git add src/main.tsx src/api src/types/operator.ts src/operator tests/operator-bidding.spec.ts tests/operator-access.spec.ts
git commit -m "feat: add mobile operator bidding app"
```

---

### Task 10: Integrate stage and source updates into the regular frontend

**Files:**
- Modify: `tcc-front/src/api/socket.ts`
- Modify: `tcc-front/src/types/lot.ts`
- Modify: `tcc-front/src/utils/officeBidHistory.ts`
- Modify: `tcc-front/src/components/OfficeBidHistory.tsx`
- Modify: `tcc-front/src/App.tsx`
- Modify: `tcc-front/tests/auction-commerce.spec.ts`
- Modify: `tcc-front/tests/office-bid-history.spec.ts`

**Interfaces:**
- Consumes: `LotStageChangedPayload` and `OfficeBidPayload.source` from Tasks 3 and 6.
- Produces: immediate regular-room lot synchronization and “Online”/“Presencial” office audit labels.

- [ ] **Step 1: Add failing event and history tests**

Extend fixtures with `source: ONLINE | ON_SITE`. Assert the table renders the corresponding Portuguese label. Emit `lot:stage-changed` from lot A to lot B and assert the public/office room immediately shows B without waiting for the existing poll. Emit a payload with `lot: null` and assert the “no lot in ring” state.

- [ ] **Step 2: Run regular frontend tests**

Run: `npm run test:e2e -- tests/office-bid-history.spec.ts tests/auction-commerce.spec.ts`

Expected: FAIL because the source column and stage listener do not exist.

- [ ] **Step 3: Extend socket and bid types**

Add:

```ts
export type BidSource = 'ONLINE' | 'ON_SITE';

export type LotStageChangedPayload = {
  auctionId: string;
  lot: {
    id: string;
    code: string;
    title: string;
    status: string;
    currentPrice?: string | null;
    nextMinimumBid?: string | null;
  } | null;
};
```

Carry `source` through `OfficeBidRecordedPayload`, `OfficeBid`, `applyOfficeBidEvent`, and HTTP reconciliation.

- [ ] **Step 4: Update regular room behavior**

Listen for `lot:stage-changed` only for the selected auction. Trigger an immediate authoritative `listLots()` refresh; use the payload for responsive display but let HTTP reconcile the full lot. Ensure stale async responses cannot overwrite a newer stage by comparing the selected auction and latest refresh sequence.

Add an “Origem” column in `OfficeBidHistory` with “Presencial” for `ON_SITE` and “Online” otherwise, keeping old rows safe through an `ONLINE` fallback.

- [ ] **Step 5: Run the complete frontend E2E suite**

Run: `npm run test:e2e`

Expected: PASS, including existing sale, privacy, polling-recovery, and session-isolation coverage.

- [ ] **Step 6: Commit regular frontend integration**

```bash
git add src/api/socket.ts src/types/lot.ts src/utils/officeBidHistory.ts src/components/OfficeBidHistory.tsx src/App.tsx tests
git commit -m "feat: show synchronized lot and bid origin"
```

---

### Task 11: Clean local test buyers and complete verification

**Files:**
- Modify only if verification exposes a defect in files owned by Tasks 1–10.
- Do not create a migration that deletes buyers.

**Interfaces:**
- Consumes: all completed backend and frontend contracts.
- Produces: a verified local database without legacy test buyers and two green repositories.

- [ ] **Step 1: Identify the exact local database before any deletion**

In `tcc-back`, inspect `DATABASE_URL`, resolve the running PostgreSQL container and database name, and print counts for `User`, `BuyerProfile`, `BuyerRegistration`, `Bid`, and `Sale`. Stop if the host/database is not the known local TCC environment.

- [ ] **Step 2: Delete only test buyers in a transaction**

List the candidate user IDs, emails, and dependency counts first. Delete the approved test set by explicit IDs inside a transaction, relying on cascades only after confirming no material sale record would be lost. Report how many users and dependent test rows were removed. Do not use a broad unverified `DELETE FROM "User"`.

- [ ] **Step 3: Run backend generation and verification**

Run in `tcc-back`:

```bash
npx prisma validate
npx prisma generate
npm test -- --runInBand
npm run test:e2e
npm run lint
npm run build
```

Expected: all commands exit `0`; migrations and generated client agree with the schema.

- [ ] **Step 4: Run frontend verification**

Run in `tcc-front`:

```bash
npm run test:e2e
npm run lint
npm run check:tokens
npm run build
```

Expected: all commands exit `0`; `/operator` remains responsive at a cellphone viewport and no token-rule violation is introduced.

- [ ] **Step 5: Perform the privacy and synchronization smoke test**

With one office, two operator codes, and two approved buyers: put lot 1 in the ring, log both operators in, move to lot 2, confirm both screens and the regular room change, place concurrent valid bids, and verify exactly one current winner. Inspect operator HTTP and socket payloads to confirm they contain no phone, email, full document, or unrelated-auction data.

- [ ] **Step 6: Confirm the verification boundary is clean**

Run: `git status --short` in each repository.

Expected: no uncommitted feature changes. If verification exposes a defect,
return to the task that owns that behavior, add a failing regression test,
apply the smallest fix, rerun that task's checks, and commit its exact listed
files before repeating this final verification. Do not create an empty commit.
