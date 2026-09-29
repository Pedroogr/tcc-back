import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import { imageSize } from 'image-size';
import type { GesturePersonBox } from '../commerce/commerce-events';

export const GESTURE_EVENT_DISPLAY_MS = 5_000;
export const GESTURE_EVENT_CAPTURE_SKEW_MS = 30_000;
export const GESTURE_EVENT_RATE_WINDOW_MS = 5_000;
export const GESTURE_EVENT_ID_TTL_MS = 60_000;
export const GESTURE_EVENT_ID_LIMIT = 512;
export const GESTURE_SNAPSHOT_MAX_BYTES = 256 * 1024;

const GESTURE_SNAPSHOT_MAX_WIDTH = 1280;
const GESTURE_SNAPSHOT_MAX_HEIGHT = 720;

export type GestureSnapshotUpload = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

export type GestureEventUpload = {
  eventId: string;
  capturedAt: string;
  personBox: string;
  snapshot?: GestureSnapshotUpload;
};

export type ValidatedGestureEvent = {
  eventId: string;
  capturedAt: Date;
  personBox: GesturePersonBox;
  snapshot: Buffer;
};

@Injectable()
export class GestureEventPolicy {
  private readonly acceptedEventIds = new Map<string, number>();
  private readonly lastAcceptedByAuction = new Map<string, number>();

  validate(
    upload: GestureEventUpload,
    now = Date.now(),
  ): ValidatedGestureEvent {
    if (typeof upload.eventId !== 'string' || !isUUID(upload.eventId)) {
      throw new BadRequestException('Identificador do gesto invalido.');
    }

    if (
      typeof upload.capturedAt !== 'string' ||
      !isISO8601(upload.capturedAt, { strict: true })
    ) {
      throw new BadRequestException('Horario de captura invalido.');
    }

    const capturedAtMs = Date.parse(upload.capturedAt);
    if (Math.abs(now - capturedAtMs) > GESTURE_EVENT_CAPTURE_SKEW_MS) {
      throw new BadRequestException(
        'Horario de captura fora da janela permitida.',
      );
    }

    const personBox = this.parsePersonBox(upload.personBox);
    const snapshot = upload.snapshot;
    if (!snapshot) {
      throw new BadRequestException('Envie a imagem capturada.');
    }
    if (snapshot.mimetype !== 'image/jpeg') {
      throw new BadRequestException('A imagem do gesto deve ser JPEG.');
    }
    if (
      !Buffer.isBuffer(snapshot.buffer) ||
      snapshot.buffer.length === 0 ||
      snapshot.buffer.length > GESTURE_SNAPSHOT_MAX_BYTES ||
      snapshot.size > GESTURE_SNAPSHOT_MAX_BYTES
    ) {
      throw new BadRequestException(
        'A imagem do gesto deve ter no maximo 256 KiB.',
      );
    }

    let dimensions: { width?: number; height?: number };
    try {
      dimensions = imageSize(snapshot.buffer);
    } catch {
      throw new BadRequestException('A imagem JPEG do gesto e invalida.');
    }
    if (
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width > GESTURE_SNAPSHOT_MAX_WIDTH ||
      dimensions.height > GESTURE_SNAPSHOT_MAX_HEIGHT
    ) {
      throw new BadRequestException(
        'A imagem do gesto deve ter no maximo 1280 por 720 pixels.',
      );
    }

    return {
      eventId: upload.eventId,
      capturedAt: new Date(capturedAtMs),
      personBox,
      snapshot: snapshot.buffer,
    };
  }

  reserve(auctionId: string, eventId: string, now = Date.now()) {
    this.prune(now);

    if (this.acceptedEventIds.has(eventId)) {
      throw new ConflictException('Este evento de gesto ja foi recebido.');
    }

    const lastAcceptedAt = this.lastAcceptedByAuction.get(auctionId);
    if (
      lastAcceptedAt !== undefined &&
      now - lastAcceptedAt < GESTURE_EVENT_RATE_WINDOW_MS
    ) {
      throw new HttpException(
        'Aguarde antes de enviar outro evento de gesto.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    while (this.acceptedEventIds.size >= GESTURE_EVENT_ID_LIMIT) {
      const oldestEventId = this.acceptedEventIds.keys().next().value as
        | string
        | undefined;
      if (!oldestEventId) {
        break;
      }
      this.acceptedEventIds.delete(oldestEventId);
    }

    this.acceptedEventIds.set(eventId, now + GESTURE_EVENT_ID_TTL_MS);
    this.lastAcceptedByAuction.set(auctionId, now);
  }

  clear() {
    this.acceptedEventIds.clear();
    this.lastAcceptedByAuction.clear();
  }

  sizeForTesting() {
    return this.acceptedEventIds.size;
  }

  private parsePersonBox(value: unknown): GesturePersonBox {
    if (typeof value !== 'string') {
      throw new BadRequestException('Area da pessoa invalida.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException('Area da pessoa invalida.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('Area da pessoa invalida.');
    }

    const candidate = parsed as Record<string, unknown>;
    const coordinates = [
      candidate.x,
      candidate.y,
      candidate.width,
      candidate.height,
    ];
    if (
      coordinates.some(
        (coordinate) =>
          typeof coordinate !== 'number' ||
          !Number.isFinite(coordinate) ||
          coordinate < 0 ||
          coordinate > 1,
      ) ||
      candidate.width === 0 ||
      candidate.height === 0
    ) {
      throw new BadRequestException('Area da pessoa invalida.');
    }

    const personBox = candidate as GesturePersonBox;
    if (
      personBox.x + personBox.width > 1 ||
      personBox.y + personBox.height > 1
    ) {
      throw new BadRequestException('Area da pessoa fora da imagem.');
    }

    return personBox;
  }

  private prune(now: number) {
    for (const [eventId, expiresAt] of this.acceptedEventIds) {
      if (expiresAt <= now) {
        this.acceptedEventIds.delete(eventId);
      }
    }

    for (const [auctionId, acceptedAt] of this.lastAcceptedByAuction) {
      if (acceptedAt + GESTURE_EVENT_RATE_WINDOW_MS <= now) {
        this.lastAcceptedByAuction.delete(auctionId);
      }
    }
  }
}
