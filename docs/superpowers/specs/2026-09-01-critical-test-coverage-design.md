# Critical Test Coverage Design

**Date:** 2026-09-01

**Repositories:** `tcc-back` and sibling `tcc-front`

## Goal

Build a maintainable safety net around the auction platform's highest-risk
business flows. The suite must detect authorization mistakes, invalid auction
state transitions, incorrect bid calculations, broken frontend/backend
contracts, and regressions in the principal user journeys.

## Current baseline

- Backend unit tests cover only the stream service and gateway. The current
  Jest coverage report is about 10% of statements.
- Backend E2E tests exercise registration, login, and static streaming pages.
- Frontend Playwright tests exercise four authentication-form behaviors.
- The frontend has no unit/component test runner.
- Neither repository has CI or enforced coverage thresholds.
- The frontend declares `/sales` and `/sales/me` calls, while the backend has
  no sales controller or module. Contract coverage must expose this mismatch;
  implementing sales is outside this testing project unless separately
  approved.

## Chosen approach

Use a layered, incremental suite:

1. Unit-test domain services and guards with focused Prisma/JWT test doubles.
2. Exercise HTTP contracts through Nest E2E tests backed by the isolated
   PostgreSQL Compose service.
3. Add Vitest and Testing Library for deterministic frontend utilities,
   request handling, and components.
4. Add Playwright journeys for cross-screen behavior, mocking only external
   browser capabilities such as camera/WebRTC where necessary.
5. Run the layers in CI and raise coverage thresholds progressively.

This provides fast feedback for business rules while retaining integration
coverage at boundaries. A primarily E2E approach was rejected because it
would make authorization and monetary edge cases slow and difficult to
diagnose. A unit-only approach was rejected because it would not detect route,
serialization, database, or frontend/backend contract mismatches.

## Isolation and existing work

Implementation will occur in isolated Git worktrees for each repository.
Existing modifications in `tcc-front/src/admin/AdminApp.tsx` and
`tcc-front/src/pages/AuctionRoomPage.tsx` are not part of this project and must
not be changed or discarded. The existing untracked backend handoff document
must also remain untouched.

## Backend unit coverage

### Lots and bids

Cover lot creation and management ownership, missing auctions/lots, allowed
lot states, buyer approval, initial price, minimum increment, replacement of
the winning bid, and rollback when bid creation fails. Transactional tests
must assert externally visible outcomes, not merely that a mock was called.

Concurrent-bid correctness requires a PostgreSQL-backed E2E scenario because
an in-memory Prisma mock cannot reproduce transaction isolation.

### Auctions and registrations

Cover office-only creation, owner-only update/delete/media management, public
visibility filters, missing auctions, thumbnail validation and replacement,
buyer registration idempotency, blocked buyers, and owner-scoped registration
review.

### Auction houses and office invitations

Cover active-only public lookup, valid/expired/revoked/used invitations,
invite e-mail matching, duplicate e-mail/CNPJ conflicts, atomic invite claim,
registration JWT shape, and buyer-registration ownership rules.

### Users, Brazilian fields, administration, and guards

Cover password hashing and safe projections, duplicate identities, seller and
buyer profile upserts, missing users, CPF/CNPJ/phone boundaries, invite
creation/revocation, and authentication for user, auction-house, and system
administrator actors. No response may expose `passwordHash`.

### Streams and sockets

Extend the existing suite to cover authentication failures, broadcaster
authorization, offer/answer/ICE routing, explicit stream end, disconnect and
rejoin behavior, and notification-room authorization.

## Backend E2E coverage

Add scenario-oriented specifications instead of one file per controller:

- office invite registration and authentication;
- auction creation and owner isolation;
- buyer registration and office review;
- lot lifecycle and bidding;
- thumbnail upload validation;
- stream REST authorization and state changes;
- route contract inventory, including the currently missing sales routes.

Factories must create only the records needed by each scenario. Database
cleanup remains centralized in `test/support/database.ts`. E2E execution must
continue using `docker-compose.e2e.yml`; the production/local development
database must never be reset by tests.

## Frontend unit and component coverage

Install Vitest, jsdom, and Testing Library using Vite-compatible configuration.
Test:

- `apiRequest` authorization headers, JSON bodies, FormData, success decoding,
  plain-text errors, and empty responses;
- Brazilian field formatting/validation and auction labels;
- authentication persistence and cleanup for malformed storage;
- bid controls, disabled/approval states, and minimum-step interaction;
- auction and lot forms, including validation and submit payloads;
- error, loading, empty, and retry states in principal lists.

Tests must prefer accessible roles and visible behavior over class names or
component internals.

## Frontend Playwright coverage

Keep authentication form tests and add journeys for:

- successful buyer and auction-house login with persisted session;
- office-invite registration;
- creating an auction and registering a lot;
- requesting and reviewing buyer approval;
- entering an auction and submitting a bid;
- administrator invite management;
- sales and wins screens, with an explicit failing contract test until the
  backend sales capability is approved and implemented;
- representative mobile viewport navigation.

API responses may be routed in UI-only scenarios. At least one full-stack
smoke path must run against the E2E backend once both applications can be
started together deterministically.

## Contract mismatch policy

A test that correctly exposes missing production behavior is not weakened or
skipped. The sales route mismatch will be reported as an expected project
blocker. Production implementation requires a separate approved design because
it introduces sale creation, authorization, and winner notification behavior.

## CI and coverage policy

Add separate workflows for backend and frontend:

- backend: build, lint without source mutation, unit tests with coverage, and
  PostgreSQL-backed E2E tests;
- frontend: build, lint, token check, unit/component coverage, and Playwright;
- upload Playwright traces and coverage reports only on failure or as CI
  artifacts, never commit generated output.

Initial backend thresholds apply to changed business modules, not the entire
legacy tree: 80% lines and statements, 70% branches, and 80% functions. The
repository-wide floor begins at the verified baseline rounded down and may
only increase. Frontend thresholds begin at 80% for the newly unit-tested API,
utility, and component files. Playwright is evaluated by required journeys,
not line coverage.

## Verification and completion criteria

The project is complete when:

1. all new unit/component tests pass locally;
2. backend E2E tests pass against the isolated database;
3. Playwright journeys terminate cleanly with no hanging web server;
4. build and non-mutating lint checks pass in both repositories;
5. CI runs the same commands successfully;
6. coverage thresholds prevent regression in newly covered modules;
7. uncovered or missing production behavior, especially sales, is documented
   as a failing contract or explicit blocker rather than silently mocked away;
8. pre-existing user changes remain untouched.

## Delivery sequence

1. Backend test helpers plus lots/bids unit coverage.
2. Auctions, registrations, invitations, users, guards, and stream coverage.
3. Backend E2E scenario coverage.
4. Frontend Vitest/Testing Library setup and deterministic tests.
5. Frontend Playwright journeys and full-stack smoke path.
6. CI, thresholds, documentation, and final verification.

