import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  GESTURE_EVENT_ID_LIMIT,
  GESTURE_SNAPSHOT_MAX_BYTES,
  GestureEventPolicy,
  type GestureEventUpload,
} from './gesture-event-policy';

const NOW = Date.parse('2026-09-29T15:00:00.000Z');

function jpeg(width = 3, height = 2, totalBytes?: number) {
  const header = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x02,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);

  if (!totalBytes || totalBytes <= header.length) {
    return header;
  }
  return Buffer.concat([header, Buffer.alloc(totalBytes - header.length)]);
}

function upload(
  overrides: Partial<GestureEventUpload> = {},
): GestureEventUpload {
  const buffer = jpeg();
  return {
    eventId: 'b7cc5e58-c196-4c8f-94b0-b669743d8a45',
    capturedAt: new Date(NOW).toISOString(),
    personBox: JSON.stringify({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }),
    snapshot: {
      originalname: 'gesture.jpg',
      mimetype: 'image/jpeg',
      buffer,
      size: buffer.length,
    },
    ...overrides,
  };
}

describe('GestureEventPolicy validation', () => {
  let policy: GestureEventPolicy;

  beforeEach(() => {
    policy = new GestureEventPolicy();
  });

  it('returns normalized metadata and the original JPEG bytes', () => {
    const input = upload();

    const result = policy.validate(input, NOW);

    expect(result).toEqual({
      eventId: input.eventId,
      capturedAt: new Date(NOW),
      personBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      snapshot: input.snapshot?.buffer,
    });
  });

  it.each([
    ['invalid UUID', { eventId: 'gesture-1' }],
    ['invalid timestamp', { capturedAt: 'not-a-date' }],
    ['old timestamp', { capturedAt: new Date(NOW - 30_001).toISOString() }],
    ['future timestamp', { capturedAt: new Date(NOW + 30_001).toISOString() }],
    ['malformed box', { personBox: '{' }],
    ['array box', { personBox: '[]' }],
    [
      'nonnumeric box',
      {
        personBox: JSON.stringify({
          x: '0.1',
          y: 0.2,
          width: 0.3,
          height: 0.4,
        }),
      },
    ],
    [
      'zero width',
      { personBox: JSON.stringify({ x: 0.1, y: 0.2, width: 0, height: 0.4 }) },
    ],
    [
      'negative coordinate',
      {
        personBox: JSON.stringify({ x: -0.1, y: 0.2, width: 0.3, height: 0.4 }),
      },
    ],
    [
      'coordinate over one',
      {
        personBox: JSON.stringify({ x: 1.1, y: 0.2, width: 0.3, height: 0.4 }),
      },
    ],
    [
      'right edge outside image',
      {
        personBox: JSON.stringify({ x: 0.8, y: 0.2, width: 0.3, height: 0.4 }),
      },
    ],
    [
      'bottom edge outside image',
      {
        personBox: JSON.stringify({ x: 0.1, y: 0.8, width: 0.3, height: 0.4 }),
      },
    ],
  ])('rejects %s', (_label, override) => {
    expect(() => policy.validate(upload(override), NOW)).toThrow(
      BadRequestException,
    );
  });

  it('rejects missing, mislabeled, invalid, oversized, and over-dimension JPEGs', () => {
    expect(() => policy.validate(upload({ snapshot: undefined }), NOW)).toThrow(
      BadRequestException,
    );
    expect(() =>
      policy.validate(
        upload({
          snapshot: {
            originalname: 'gesture.png',
            mimetype: 'image/png',
            buffer: jpeg(),
            size: jpeg().length,
          },
        }),
        NOW,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      policy.validate(
        upload({
          snapshot: {
            originalname: 'broken.jpg',
            mimetype: 'image/jpeg',
            buffer: Buffer.from('not-a-jpeg'),
            size: 10,
          },
        }),
        NOW,
      ),
    ).toThrow(BadRequestException);

    const oversized = jpeg(3, 2, GESTURE_SNAPSHOT_MAX_BYTES + 1);
    expect(() =>
      policy.validate(
        upload({
          snapshot: {
            originalname: 'large.jpg',
            mimetype: 'image/jpeg',
            buffer: oversized,
            size: oversized.length,
          },
        }),
        NOW,
      ),
    ).toThrow(BadRequestException);

    for (const dimensions of [jpeg(1281, 720), jpeg(1280, 721)]) {
      expect(() =>
        policy.validate(
          upload({
            snapshot: {
              originalname: 'dimensions.jpg',
              mimetype: 'image/jpeg',
              buffer: dimensions,
              size: dimensions.length,
            },
          }),
          NOW,
        ),
      ).toThrow(BadRequestException);
    }
  });
});

describe('GestureEventPolicy reservation', () => {
  let policy: GestureEventPolicy;

  beforeEach(() => {
    policy = new GestureEventPolicy();
  });

  it('rejects duplicate accepted IDs for 60 seconds', () => {
    policy.reserve('auction-1', 'event-1', NOW);

    expect(() =>
      policy.reserve('auction-2', 'event-1', NOW + 60_000 - 1),
    ).toThrow(ConflictException);
    expect(() =>
      policy.reserve('auction-2', 'event-1', NOW + 60_000),
    ).not.toThrow();
  });

  it('allows only one accepted event per auction in each five-second window', () => {
    policy.reserve('auction-1', 'event-1', NOW);

    try {
      policy.reserve('auction-1', 'event-2', NOW + 4_999);
      throw new Error('Expected rate-limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    expect(() =>
      policy.reserve('auction-2', 'event-3', NOW + 4_999),
    ).not.toThrow();
    expect(() =>
      policy.reserve('auction-1', 'event-4', NOW + 5_000),
    ).not.toThrow();
  });

  it('bounds the accepted ID cache to 512 entries', () => {
    for (let index = 0; index <= GESTURE_EVENT_ID_LIMIT; index += 1) {
      policy.reserve(`auction-${index}`, `event-${index}`, NOW + index);
    }

    expect(policy.sizeForTesting()).toBe(GESTURE_EVENT_ID_LIMIT);
    expect(() =>
      policy.reserve('another-auction', 'event-0', NOW + 1_000),
    ).not.toThrow();
  });

  it('clears all ephemeral state', () => {
    policy.reserve('auction-1', 'event-1', NOW);
    policy.clear();

    expect(policy.sizeForTesting()).toBe(0);
    expect(() => policy.reserve('auction-1', 'event-1', NOW)).not.toThrow();
  });
});
