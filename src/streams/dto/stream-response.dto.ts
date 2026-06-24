import type {
  AuctionStatus,
  StreamStatus,
} from '../../../generated/prisma/enums';

export type SafeStreamDto = {
  id: string;
  status: StreamStatus;
  streamUrl: string | null;
  protocol: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AuctionStreamResponseDto = {
  auctionId: string;
  room: string;
  canBroadcast: boolean;
  auction: {
    id: string;
    status: AuctionStatus;
    auctionHouseId: string;
  };
  stream: SafeStreamDto | null;
};
