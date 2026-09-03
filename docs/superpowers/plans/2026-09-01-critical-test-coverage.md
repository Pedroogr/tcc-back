# Critical Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add layered automated coverage for the auction platform's critical authorization, monetary, state-transition, HTTP-contract, and browser journeys.

**Architecture:** Keep fast domain tests beside Nest services, scenario E2E tests under `tcc-back/test`, deterministic Vitest/Testing Library tests beside frontend modules, and Playwright for cross-screen journeys. Share narrowly scoped factories within each test layer; do not add test-only branches to production code.

**Tech Stack:** NestJS 11, Jest 30, Supertest, Prisma/PostgreSQL 16, React 19, Vite 8, Vitest, jsdom, Testing Library, Playwright 1.62, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-critical-test-coverage-design.md`

## Global Constraints

- Preserve existing edits in `tcc-front/src/admin/AdminApp.tsx` and `tcc-front/src/pages/AuctionRoomPage.tsx`.
- Preserve the existing untracked `tcc-back/docs/handoff.md`.
- Never point E2E cleanup at the local development or production database; use `docker-compose.e2e.yml` and port 5435 only.
- Do not expose `passwordHash` in assertions, fixtures returned as API responses, logs, or snapshots.
- Use accessible roles and visible behavior in frontend tests; do not assert CSS implementation details.
- Keep the missing `/sales` backend contract visible; do not invent production sale behavior in this project.
- Use `npm.cmd` on Windows because the machine blocks `npm.ps1`.

---

### Task 1: Isolated workspaces and clean baseline

**Files:**
- Use: `tcc-back/package.json`
- Use: `tcc-front/package.json`
- Create worktrees under: `C:/Users/ribei/Documentos/codigos/TCC/.worktrees/`

**Interfaces:**
- Consumes: committed backend spec `0969309` and the current frontend branch without its uncommitted files.
- Produces: `test/critical-coverage` branches in isolated backend and frontend worktrees.

- [ ] **Step 1: Detect worktree state and ignore rules**

Run in each repository:

```powershell
git rev-parse --git-dir
git rev-parse --git-common-dir
git rev-parse --show-superproject-working-tree
git branch --show-current
git check-ignore -v ..\.worktrees
```

Expected: both source directories are normal checkouts; the common root `.worktrees` directory is outside both repository trees.

- [ ] **Step 2: Create isolated worktrees**

```powershell
git worktree add ..\.worktrees\tcc-back-critical-tests -b test/critical-coverage
git worktree add ..\.worktrees\tcc-front-critical-tests -b test/critical-coverage
```

Run each command from its matching repository. Expected: two worktrees on independent branches.

- [ ] **Step 3: Install from existing lockfiles**

```powershell
npm.cmd ci
```

Run in both worktrees. Expected: dependencies install without lockfile changes.

- [ ] **Step 4: Verify the baseline**

```powershell
npm.cmd test -- --runInBand
npm.cmd run build
```

Run backend unit tests and build. Run `npm.cmd run build` and `npm.cmd run test:e2e` in the frontend. Expected: backend has 15 passing unit tests; frontend reports four passing Playwright cases. If Docker is active, also run `npm.cmd run test:e2e` in the backend; otherwise record the Docker dependency and continue with non-E2E tasks.

### Task 2: Backend test-double builders and Brazilian fields

**Files:**
- Create: `tcc-back/src/test-support/prisma-mock.ts`
- Create: `tcc-back/src/test-support/actors.ts`
- Create: `tcc-back/src/common/br-fields.spec.ts`

**Interfaces:**
- Produces: `createPrismaMock()` returning Jest mocks for used Prisma delegates and `$transaction`; `userActor()` and `auctionHouseActor()` returning `AuthenticatedActor` fixtures.
- Consumes: `AuthenticatedActor`, Prisma decimal support, and exported functions from `br-fields.ts`.

- [ ] **Step 1: Write focused tests for CPF, CNPJ, and phone boundaries**

Cover optional empty values, formatted valid values, repeated digits, invalid check digits, 10/11-digit phones, invalid lengths, and a cellular number without ninth digit. Assert normalized values and exact Nest exception types.

- [ ] **Step 2: Run the new spec**

```powershell
npm.cmd test -- br-fields.spec.ts --runInBand
```

Expected: existing behavior cases pass; any mismatch must be classified as a production defect before alteration.

- [ ] **Step 3: Add typed reusable test builders**

Use explicit `jest.Mock` delegate members rather than `any`. Implement `$transaction` as:

```ts
$transaction: jest.fn(async (callback) => callback(prismaMock)),
```

Actors must contain the real discriminated union shape used by services.

- [ ] **Step 4: Re-run all backend unit tests**

```powershell
npm.cmd test -- --runInBand
```

Expected: existing 15 tests plus the Brazilian-field cases pass.

- [ ] **Step 5: Commit**

```powershell
git add src/test-support src/common/br-fields.spec.ts
git commit -m "test: cover Brazilian fields and add service fixtures"
```

### Task 3: Lots and bids unit coverage

**Files:**
- Create: `tcc-back/src/lots/lots.service.spec.ts`
- Modify only if a failing regression proves a defect: `tcc-back/src/lots/lots.service.ts`

**Interfaces:**
- Consumes: `createPrismaMock`, actor builders, `LotsService.create`, `update`, `remove`, and `createBid`.
- Produces: characterization and regression coverage for ownership and monetary rules.

- [ ] **Step 1: Add lot-management authorization cases**

Test missing auction, user actor creation, foreign office creation, owner creation with normalized Prisma data, missing lot, owner update/delete, foreign office rejection, and ordinary-user rejection.

- [ ] **Step 2: Run the lot spec and inspect failures**

```powershell
npm.cmd test -- lots.service.spec.ts --runInBand
```

Expected: failures must indicate either an incorrect fixture or a real authorization defect; do not weaken ownership assertions.

- [ ] **Step 3: Add bid eligibility cases**

Test office actors, missing lots, detached lots, disallowed lot states, absent/pending/rejected/blocked registration, and approved registration.

- [ ] **Step 4: Add bid amount and transaction cases**

Test first bid at initial price, rejection below initial price, exact minimum increment after a winner, rejection below increment, previous winner becoming `OUTBID`, new winner becoming `WINNING`, and rollback/error propagation when creation fails.

- [ ] **Step 5: Run the lot spec and full backend unit suite**

```powershell
npm.cmd test -- lots.service.spec.ts --runInBand
npm.cmd test -- --runInBand
```

Expected: all tests pass. Any production correction follows a witnessed red-green cycle in this spec.

- [ ] **Step 6: Commit**

```powershell
git add src/lots/lots.service.spec.ts src/lots/lots.service.ts
git commit -m "test: cover lot ownership and bidding rules"
```

### Task 4: Auctions and buyer registrations unit coverage

**Files:**
- Create: `tcc-back/src/auctions/auctions.service.spec.ts`
- Modify only for proven defects: `tcc-back/src/auctions/auctions.service.ts`

**Interfaces:**
- Consumes: test-support builders and `AuctionsService` public methods.
- Produces: coverage for office ownership, public filtering, registration status, and thumbnail validation.

- [ ] **Step 1: Test create/read/update/delete authorization**

Cover office-only creation, owner connection, public query exclusions for `DRAFT`/`CANCELED`, missing IDs, owner update/delete, foreign office rejection, and user rejection.

- [ ] **Step 2: Test buyer registration behavior**

Cover user-only requests, missing auctions, blocked registrations, approved idempotency, and rejected/pending reset to `PENDING` with timestamps cleared.

- [ ] **Step 3: Test office review scoping**

Cover user rejection, missing registration, registration belonging to another office, and approved/rejected timestamps.

- [ ] **Step 4: Test thumbnail boundaries without retaining files**

Use a temporary upload directory or mock `node:fs/promises`. Cover missing file, MIME allowlist, 5 MB maximum, replacement cleanup, foreign-office denial, and removal of only `/uploads/auctions/` paths.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- auctions.service.spec.ts --runInBand
npm.cmd test -- --runInBand
git add src/auctions/auctions.service.spec.ts src/auctions/auctions.service.ts
git commit -m "test: cover auction ownership and registrations"
```

### Task 5: Invitations, users, administration, and guards

**Files:**
- Create: `tcc-back/src/auction-houses/auction-houses.service.spec.ts`
- Create: `tcc-back/src/users/users.service.spec.ts`
- Create: `tcc-back/src/admin/admin.service.spec.ts`
- Create: `tcc-back/src/auth/actor-jwt-auth.guard.spec.ts`
- Create: `tcc-back/src/auth/jwt-auth.guard.spec.ts`
- Create: `tcc-back/src/auth/system-admin.guard.spec.ts`

**Interfaces:**
- Consumes: service/guard public APIs and shared backend test builders.
- Produces: regression coverage for invite claims, safe user projections, and all actor types.

- [ ] **Step 1: Test auction-house invitations**

Cover active-only lookup, missing/expired/revoked/used tokens, e-mail mismatch, atomic `updateMany` claim count, duplicate Prisma `P2002`, normalization, password hashing, JWT actor claims, and no `passwordHash` in returned office.

- [ ] **Step 2: Test auction-house buyer registrations**

Cover blocked/approved/idempotent request behavior, office-only lists, user self-lookup, and owner-only review.

- [ ] **Step 3: Test users and admin invites**

Cover password hashing, safe select shape, duplicate conflicts, missing users, profile upserts, password update, invite expiry calculation, list URL mapping, missing/revoked invite behavior.

- [ ] **Step 4: Test guards using real JWT signing where practical**

Cover absent/malformed/invalid tokens, inactive accounts, user token, office token, wrong actor for user-only guard, non-admin user, and active `SYSTEM_ADMIN` user. Assert request actor/user assignment.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- auction-houses.service.spec.ts users.service.spec.ts admin.service.spec.ts actor-jwt-auth.guard.spec.ts jwt-auth.guard.spec.ts system-admin.guard.spec.ts --runInBand
npm.cmd test -- --runInBand
git add src/auction-houses src/users src/admin src/auth
git commit -m "test: cover identities invitations and guards"
```

### Task 6: Complete stream and socket unit coverage

**Files:**
- Modify: `tcc-back/src/streams/streams.service.spec.ts`
- Modify: `tcc-back/src/streams/streams.gateway.spec.ts`
- Create: `tcc-back/src/live/live.gateway.spec.ts`

**Interfaces:**
- Consumes: current stream service/gateway fixtures.
- Produces: coverage for authentication, signal routing, explicit endings, disconnects, and legacy live relay behavior.

- [ ] **Step 1: Add uncovered stream-service branches**

Cover stream lookup permissions, office stop/interrupt wrappers, missing streams, broadcaster join assertions, and error propagation.

- [ ] **Step 2: Add gateway authentication and signaling cases**

Cover broadcaster denial, viewer join, offer, answer, ICE, stream-ended, target-room validation, bad JWT, inactive actor, and disconnect cleanup.

- [ ] **Step 3: Characterize the legacy live gateway**

Test room join and offer/answer/ICE forwarding so accidental changes are detected while the newer streams gateway exists.

- [ ] **Step 4: Verify and commit**

```powershell
npm.cmd test -- streams.service.spec.ts streams.gateway.spec.ts live.gateway.spec.ts --runInBand
npm.cmd run test:cov -- --runInBand
git add src/streams src/live/live.gateway.spec.ts
git commit -m "test: complete stream signaling coverage"
```

### Task 7: Backend E2E business scenarios

**Files:**
- Modify: `tcc-back/test/support/factories.ts`
- Create: `tcc-back/test/office-invites.e2e-spec.ts`
- Create: `tcc-back/test/auction-lifecycle.e2e-spec.ts`
- Create: `tcc-back/test/bidding.e2e-spec.ts`
- Create: `tcc-back/test/streams.e2e-spec.ts`
- Create: `tcc-back/test/contracts.e2e-spec.ts`

**Interfaces:**
- Consumes: `createE2eApp`, `resetDatabase`, isolated PostgreSQL, JWT helpers.
- Produces: HTTP-level evidence for ownership, status, transactions, and route inventory.

- [ ] **Step 1: Extend factories with explicit scenario builders**

Add builders for auction, approved buyer registration, lot, winning bid, office invite, and authorization headers. Every builder accepts overrides and returns created Prisma rows.

- [ ] **Step 2: Add office invitation E2E scenarios**

Exercise validate/register, expired/revoked/used tokens, duplicate data, JWT response, and simultaneous claims where exactly one succeeds.

- [ ] **Step 3: Add auction and lot lifecycle scenarios**

Exercise owner create/update/delete, foreign-office denial, public visibility, thumbnail validation, lot creation/update, and status progression.

- [ ] **Step 4: Add registration and bidding scenarios**

Exercise request/review, blocked buyer, minimum increment, outbid transition, and two concurrent bids; verify one winning bid remains.

- [ ] **Step 5: Add stream REST scenarios**

Exercise missing/invalid actors, owner start/stop, viewer state, and foreign-office denial.

- [ ] **Step 6: Add contract inventory**

Assert documented frontend endpoints exist. Keep the three `/sales` expectations in a separately named test that demonstrates the current 404 mismatch and reports it as the known production blocker rather than fabricating responses.

- [ ] **Step 7: Run E2E and commit**

```powershell
npm.cmd run test:e2e
git add test
git commit -m "test: cover backend auction lifecycle end to end"
```

Expected: all implemented contracts pass; the sales contract is reported separately as the known failing blocker until a sales design is approved.

### Task 8: Frontend Vitest and Testing Library foundation

**Files:**
- Modify: `tcc-front/package.json`
- Modify: `tcc-front/package-lock.json`
- Modify: `tcc-front/vite.config.ts`
- Create: `tcc-front/src/test/setup.ts`
- Create: `tcc-front/src/api/http.test.ts`
- Create: `tcc-front/src/utils/brFields.test.ts`
- Create: `tcc-front/src/utils/auctionLabels.test.ts`
- Modify only for proven defects: `tcc-front/src/api/http.ts`

**Interfaces:**
- Produces: `npm run test`, `npm run test:watch`, and `npm run test:cov` frontend scripts.
- Consumes: browser-compatible jsdom environment and existing Vite config.

- [ ] **Step 1: Install test dependencies**

```powershell
npm.cmd install --save-dev vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Configure Vitest**

Add a `test` block with `environment: 'jsdom'`, setup file, CSS enabled, V8 coverage, and explicit includes for `src/**/*.test.{ts,tsx}`. Add package scripts for run/watch/coverage.

- [ ] **Step 3: Test utilities**

Cover formatting truncation, valid/invalid check digits, phone boundaries, generated document validity, known/unknown status labels, and null defaults.

- [ ] **Step 4: Test the HTTP wrapper**

Stub `fetch` and `localStorage`. Cover bearer tokens, caller header precedence, FormData content type omission, JSON success, text error, empty error fallback, and 204/empty success. If the empty success case fails at `response.json()`, update `apiRequest` to return `undefined as T` for status 204 or empty content.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd run test
npm.cmd run test:cov
npm.cmd run build
git add package.json package-lock.json vite.config.ts src/test src/api/http.ts src/api/http.test.ts src/utils
git commit -m "test: add frontend unit test foundation"
```

### Task 9: Frontend component behavior

**Files:**
- Create: `tcc-front/src/pages/auction-room/BidPanel.test.tsx`
- Create: `tcc-front/src/pages/CreateAuctionPage.test.tsx`
- Create: `tcc-front/src/pages/RegisterLotPage.test.tsx`
- Create: `tcc-front/src/pages/sales/SaleRecordList.test.tsx`
- Create: `tcc-front/src/components/CameraPreviewModal.test.tsx`

**Interfaces:**
- Consumes: existing component props and Testing Library setup.
- Produces: accessible behavior coverage for primary forms and stateful controls.

- [ ] **Step 1: Test bid states and step interaction**

Cover unauthenticated, approval required/pending/blocked, enabled bidder, positive/negative step buttons, minimum display, disabled submit, and submit event.

- [ ] **Step 2: Test auction and lot forms**

Cover required fields, controlled changes, thumbnail selection/clear, image add/remove, auction selection, and exact submit callback invocation.

- [ ] **Step 3: Test list states and camera lifecycle**

Cover sales loading/error/empty/data and retry. Mock `navigator.mediaDevices` to cover camera denial, preview, track cleanup, cancel, and confirm.

- [ ] **Step 4: Verify and commit**

```powershell
npm.cmd run test
npm.cmd run test:cov
npm.cmd run build
git add src
git commit -m "test: cover frontend auction components"
```

### Task 10: Playwright journeys and clean termination

**Files:**
- Modify: `tcc-front/playwright.config.ts`
- Modify: `tcc-front/tests/auth-ui.spec.ts`
- Create: `tcc-front/tests/auction-house.spec.ts`
- Create: `tcc-front/tests/buyer-bidding.spec.ts`
- Create: `tcc-front/tests/admin.spec.ts`
- Create: `tcc-front/tests/sales-contract.spec.ts`
- Create: `tcc-front/tests/support/api.ts`

**Interfaces:**
- Consumes: route fixtures matching backend DTOs and stored auth keys.
- Produces: deterministic browser journeys for each principal actor.

- [ ] **Step 1: Create API route-fixture helpers**

Provide helpers that fulfill auth, auction, lot, registration, admin, and sale routes with typed fixtures. Reject unhandled mutating routes so false-positive journeys fail visibly.

- [ ] **Step 2: Add authentication persistence journeys**

Cover buyer and office login, localStorage actor data, logout cleanup, and invalid stored JSON recovery.

- [ ] **Step 3: Add office and buyer journeys**

Cover auction creation, lot registration, registration review, approval request, entering a room, bid increment, and bid submission.

- [ ] **Step 4: Add admin and sales contract journeys**

Cover invite listing/create/revoke. Demonstrate that the sales screens request `/sales` and `/sales/me`; keep the backend 404 mismatch visible in the separately named contract audit.

- [ ] **Step 5: Add a mobile project and ensure termination**

Add Pixel 7 (or equivalent) viewport coverage for authentication/home navigation. Set `reuseExistingServer: !process.env.CI`, bounded `webServer.timeout`, and CI retries. Diagnose and remove the current post-report hang before accepting the task.

- [ ] **Step 6: Verify and commit**

```powershell
npm.cmd run test:e2e
npm.cmd run build
git add playwright.config.ts tests
git commit -m "test: cover critical browser journeys"
```

Expected: Playwright exits with code 0 after reporting all required journeys.

### Task 11: CI, thresholds, and final documentation

**Files:**
- Modify: `tcc-back/package.json`
- Create: `tcc-back/.github/workflows/test.yml`
- Modify: `tcc-front/package.json`
- Create: `tcc-front/.github/workflows/test.yml`
- Modify: `tcc-back/README.md`
- Modify: `tcc-front/README.md`

**Interfaces:**
- Consumes: all preceding package scripts.
- Produces: repeatable CI gates and documented local commands.

- [ ] **Step 1: Add non-mutating lint scripts**

Keep existing developer formatting/fix scripts, but add `lint:check` commands that never use `--fix`. CI must call only `lint:check`.

- [ ] **Step 2: Add scoped coverage thresholds**

Configure 80% statements/lines/functions and 70% branches for newly covered backend business modules and newly tested frontend API/utility/component files. Set the backend global floor no higher than the freshly measured rounded-down baseline.

- [ ] **Step 3: Add backend workflow**

Use Node matching the lockfile, `npm ci`, PostgreSQL service or Docker Compose-compatible E2E setup, build, lint check, unit coverage, and E2E. Cache npm, not `node_modules`.

- [ ] **Step 4: Add frontend workflow**

Use `npm ci`, Playwright browser installation, build, lint/token checks, unit coverage, and browser tests. Upload traces and reports on failure.

- [ ] **Step 5: Document exact validation commands**

Document unit, coverage, E2E, build, and lint commands plus Docker requirements and the known sales contract blocker.

- [ ] **Step 6: Run final verification**

```powershell
npm.cmd run build
npm.cmd run lint:check
npm.cmd run test:cov -- --runInBand
npm.cmd run test:e2e
```

Run in backend, then run the matching build/lint/test/coverage/Playwright commands in frontend. Inspect exit codes and test counts.

- [ ] **Step 7: Verify repository scope and commit**

```powershell
git status --short --untracked-files=all
git diff --check
git log --oneline --decorate -8
```

Confirm no environment files, uploads, generated reports, user modifications, or unrelated files are included. Commit final CI/docs changes separately in each repository.

