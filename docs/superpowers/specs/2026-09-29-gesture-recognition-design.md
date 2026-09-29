# Gesture Recognition Assistance Design

**Date:** 2026-09-29

**Projects:** `tcc-front` and `tcc-back`

**Status:** Approved

## Goal

Assist the mobile on-site operator (`pisteiro`) in identifying the first person
who raises a hand during an in-person auction. A dedicated computer operated by
the filming team captures the audience and runs pose inference locally in the
browser. The remote API relays one short-lived annotated snapshot to the
operator's phone. Recognition never creates a bid and never identifies a buyer;
the operator remains responsible for recognizing the person, selecting the
registered buyer, and confirming the bid.

## Approved user experience

The filming team uses a dedicated camera connected to a dedicated computer. An
auction-house account opens a new Gesture Station screen, selects an owned
auction and camera, and starts recognition.

The operator continues to use the existing `/operator` route on a phone. When
the station detects the first raised hand, the phone displays the approved
mobile overlay:

- the current operator screen stays mounted behind the alert;
- one annotated image highlights the detected person;
- a visible five-second countdown closes the alert automatically;
- a 200-millisecond notification sound plays, and the vibration pattern
  `[150, 75, 150]` is requested where the browser supports it;
- colors use the existing frontend tokens: `--background`, `--card`,
  `--primary`, `--border`, and `--foreground`; `--price` remains exclusive to
  monetary values;
- the production UI contains no fake data, preview query, or demonstration
  control.

The alert is optimized for one-handed mobile use while the operator moves
around the venue. It does not require an acknowledgement and does not block the
operator beyond covering part of the current view for five seconds.

## Delivery order

The work is deliberately split into two delivery cycles.

1. Implement the frontend-only operator screen and reusable alert component.
   Verify, commit, and push `tcc-front` before beginning the recognition or API
   integration. The component accepts real event-shaped properties but remains
   hidden because no production event source exists yet.
2. Implement browser inference, the Gesture Station, the authenticated backend
   relay, Socket.IO delivery, and end-to-end integration.

The first cycle must not add a mock production event source merely to make the
overlay visible.

## Browser inference architecture

The dedicated filming computer performs all continuous video processing. The
camera stream and video frames do not leave that computer.

The current `yolo11s-pose.pt` proof-of-concept model is exported from PyTorch to
ONNX with a fixed 1280-pixel input. The frontend loads the model through ONNX
Runtime Web and runs it with WebGPU when available, falling back to WebAssembly.
Model loading and inference live behind a `PoseEstimator` interface so a later
model replacement does not affect the station UI, round state, or API contract.

The station is divided into isolated units:

- `GestureDetector` owns preprocessing, ONNX inference, pose postprocessing,
  and the normalized person/keypoint result;
- `GestureRoundTracker` owns temporary track IDs, raised-hand transitions,
  ordering, the selected first person, and round re-arming;
- `GestureSnapshot` draws the selected bounding box and label into a reduced
  JPEG image;
- the Gesture Station page owns camera selection, lifecycle controls,
  compatibility messages, and authenticated event submission.

Inference must not run on the main React rendering path. The implementation
loads ONNX Runtime and performs inference inside a dedicated worker for both
WebGPU and WebAssembly execution. Rendering receives only reduced detection
results at a lower frequency than inference.

## Detection and round rules

A person is valid only when the same confidence and body-shape checks used by
the proof of concept pass. A raised hand is valid only after it appears in at
least three consecutive inference samples spanning at least 250 milliseconds.
These values are named configuration constants and covered by deterministic
tests.

The first rising edge from hand-down to hand-up wins the round. If several
people raise their hands close together, the earliest local monotonic timestamp
wins. The selected person remains fixed for five seconds even if the hand is
lowered. At the end of the five seconds, the station does not immediately
select a still-raised hand: it re-arms only after no valid raised hand remains
for 500 continuous milliseconds. This prevents one sustained gesture from
generating repeated alerts.

Tracking identities are temporary and exist only inside the station session.
They are not buyer identities, are not persisted, and are never shown as proof
of who placed a bid.

## HTTP contract

The backend adds an authenticated endpoint:

`POST /auctions/:auctionId/gesture-events`

The request uses multipart form data:

- `eventId`: client-generated UUID used for idempotency;
- `capturedAt`: ISO timestamp for diagnostics and ordering;
- `personBox`: normalized `{ x, y, width, height }` JSON value;
- `snapshot`: one annotated JPEG image.

Only an authenticated `AUCTION_HOUSE` actor that owns the auction may submit an
event. The auction must exist and must not be finished or canceled. The backend
validates the UUID, timestamp, normalized box, MIME type, image dimensions,
maximum byte size, and per-auction submission rate before broadcasting.

The station resizes the snapshot to at most 960 by 540 pixels and encodes it as
JPEG at quality `0.72`. The backend accepts only `image/jpeg`, a maximum of 256
KiB, dimensions no larger than 1280 by 720, normalized box values between zero
and one, and a `capturedAt` value within 30 seconds of server time. It accepts
at most one gesture event per auction in each five-second window.

The backend keeps at most 512 event IDs for 60 seconds in a short-lived
in-memory idempotency set. It does not create a database model, write the
snapshot to disk, or retain the event after relay. If the deployment later
becomes multi-instance, this idempotency and relay boundary must move to shared
ephemeral infrastructure before horizontal scaling is enabled.

## Realtime contract

The existing commerce gateway adds an operator-only room:

`auction:<auctionId>:operators`

An authenticated operator joins that room only when the operator access token
is valid for the requested auction. Auction-house and buyer actors do not join
it. Existing price, buyer, and office rooms keep their current privacy rules.

After accepting the HTTP request, the API emits
`gesture:first-hand-detected` to the operator room. The event contains:

- `eventId`;
- `auctionId`;
- `capturedAt`;
- `expiresAt`, calculated by the server for a five-second display window;
- normalized person box;
- image MIME type and binary snapshot bytes.

The operator client ignores duplicate or wrong-auction events. A newer accepted
event replaces any currently displayed alert, revoking the previous object URL
before creating the next one. Closing, replacement, unmounting, logout, and
session expiration all clear timers and revoke object URLs.

Events are deliberately ephemeral. An operator who reconnects does not receive
historical gesture events. An event that has already expired when received is
discarded.

## Frontend component boundaries

The first delivery cycle introduces a reusable `GestureFirstHandAlert`
component and a small alert-state utility. The component receives snapshot URL,
event identity, capture/expiry timestamps, and close behavior through typed
properties. It owns presentation and accessibility, not sockets or API calls.

`OperatorBidPage` owns the current alert state and later subscribes to the
Socket.IO event. The alert is rendered in a layer above the existing mobile
operator flow. The current buyer selection, amount, review dialog, and
authoritative session reconciliation remain unchanged.

The Gesture Station is added only in the second cycle. It is reachable from an
owned auction's management flow and reuses the current auction-house session.
The filming computer does not share the one-time operator code.

## Failure behavior

- Camera denial or disconnection leaves the station stopped and explains how
  to select or authorize a camera.
- Model download or initialization failure offers a retry without reloading the
  whole application.
- When WebGPU is unavailable, the station reports that CPU fallback is active.
  The station measures rolling ten-second windows; if throughput remains below
  five inference samples per second for two consecutive windows, it marks
  recognition unreliable and pauses event emission. Emission resumes after one
  complete window at or above five samples per second.
- Network loss does not stop local camera inference, but the station shows that
  alerts cannot reach the operator and does not queue stale snapshots for later
  delivery.
- Invalid, oversized, duplicate, too-frequent, unauthorized, or wrong-auction
  submissions receive stable client errors and cause no socket emission.
- Mobile sound or vibration failure never prevents the visual alert.
- A socket reconnect joins the current operator auction again but receives only
  future events.

## Privacy and security

Continuous video remains on the filming computer. The API receives only one
annotated compressed snapshot per accepted round and holds it only long enough
to emit the realtime event. No face recognition, biometric matching, buyer
identification, database history, or filesystem persistence is introduced.

The HTTP endpoint uses the existing actor guard and server-derived auction-house
identity. Ownership is checked on every request. The operator room uses the
existing operator-token validation, including expiry, revocation, auction
binding, and terminal auction state. Client-provided room names or actor IDs are
never trusted.

Snapshot limits and rate limiting protect API memory and bandwidth. Public
errors do not disclose internal model, filesystem, or actor details.

## Testing strategy

The first frontend cycle covers:

- countdown and automatic close behavior with controllable time;
- replacement by a newer event and ignoring duplicates;
- cleanup of timers and object URLs on close, replacement, and unmount;
- mobile layout, semantic alert markup, countdown text, and official design
  tokens;
- sound/vibration capability checks without treating unsupported APIs as an
  error;
- the existing operator bidding flow remaining functional;
- lint, token validation, TypeScript production build, and relevant Playwright
  suites before commit and push.

The integration cycle covers pure detector and round-state logic with
deterministic fixtures, including simultaneous raises, transient false
positives, hand lowering, five-second selection, absence cleanup, and re-arming.
Browser tests mock ONNX inference while verifying camera and worker lifecycle.

Backend E2E tests cover ownership, auction state, multipart validation, image
limits, idempotency, rate limiting, absence of persistence, operator-only room
membership, binary event delivery, and absence of cross-auction emissions. A
final browser E2E test connects a station and operator session to the real test
API and verifies that one accepted snapshot appears and expires on the phone.

Real model performance is benchmarked separately on the intended filming
computer. Automated correctness tests do not depend on camera hardware, GPU
availability, or nondeterministic neural-network output.

## Non-goals

- Automatically registering a bid from a gesture.
- Identifying a person or associating a track ID with a buyer.
- Using the broadcast camera or the operator's phone camera.
- Sending continuous video to the API.
- Saving gesture images or a gesture history.
- Replacing the operator's manual buyer selection and bid confirmation.
- Supporting several backend instances without shared ephemeral transport.
