import {
  AuctionStatus,
  BidStatus,
  BuyerRegistrationStatus,
  ConsignmentStatus,
  LotStatus,
  Prisma,
  SaleStatus,
  StreamStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

export const E2E_PASSWORD = 'cattle-auction-e2e-password';
export const E2E_PASSWORD_HASH =
  '$2b$10$qYmzXjQY65BDksbjS1Uoq.D7nVD8n2TRx1BPuy2eqOerGNh24da1O';

let sequence = 0;

function nextValue(prefix: string) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export async function createUser(
  prisma: PrismaService,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const value = nextValue('user');
  return prisma.user.create({
    data: {
      name: `E2E User ${value}`,
      email: `${value}@example.test`,
      passwordHash: E2E_PASSWORD_HASH,
      ...overrides,
    },
  });
}

export async function createAuctionHouse(
  prisma: PrismaService,
  overrides: Partial<Prisma.AuctionHouseUncheckedCreateInput> = {},
) {
  const value = nextValue('auction-house');
  return prisma.auctionHouse.create({
    data: {
      name: `E2E Auction House ${value}`,
      email: `${value}@example.test`,
      passwordHash: E2E_PASSWORD_HASH,
      ...overrides,
    },
  });
}

export async function createBuyer(prisma: PrismaService) {
  const user = await createUser(prisma);
  return prisma.buyerProfile.create({
    data: { userId: user.id },
    include: { user: true },
  });
}

export async function createSeller(prisma: PrismaService) {
  const user = await createUser(prisma);
  return prisma.sellerProfile.create({
    data: { userId: user.id },
    include: { user: true },
  });
}

export async function createAuction(
  prisma: PrismaService,
  auctionHouseId: string,
  overrides: Partial<Prisma.AuctionUncheckedCreateInput> = {},
) {
  const value = nextValue('auction');
  return prisma.auction.create({
    data: {
      title: `E2E Auction ${value}`,
      auctionHouseId,
      status: AuctionStatus.DRAFT,
      ...overrides,
    },
  });
}

export async function createLot(
  prisma: PrismaService,
  auctionId: string,
  overrides: Partial<Prisma.LotUncheckedCreateInput> = {},
) {
  const value = nextValue('lot');
  return prisma.lot.create({
    data: {
      code: value,
      title: `E2E Lot ${value}`,
      auctionId,
      status: LotStatus.DRAFT,
      ...overrides,
    },
  });
}

export async function createBid(
  prisma: PrismaService,
  lotId: string,
  bidderId: string,
  overrides: Partial<Prisma.BidUncheckedCreateInput> = {},
) {
  return prisma.bid.create({
    data: {
      lotId,
      bidderId,
      amount: 100,
      status: BidStatus.VALID,
      ...overrides,
    },
  });
}

export async function createBuyerRegistration(
  prisma: PrismaService,
  buyerId: string,
  auctionHouseId: string,
  overrides: Partial<Prisma.BuyerRegistrationUncheckedCreateInput> = {},
) {
  return prisma.buyerRegistration.create({
    data: {
      buyerId,
      auctionHouseId,
      status: BuyerRegistrationStatus.APPROVED,
      ...overrides,
    },
  });
}

export async function createConsignment(
  prisma: PrismaService,
  sellerId: string,
  auctionHouseId: string,
  overrides: Partial<Prisma.ConsignmentUncheckedCreateInput> = {},
) {
  return prisma.consignment.create({
    data: {
      sellerId,
      auctionHouseId,
      status: ConsignmentStatus.APPROVED,
      ...overrides,
    },
  });
}

export async function createSale(
  prisma: PrismaService,
  lotId: string,
  buyerId: string,
  saleRecordedByAuctionHouseId: string,
  overrides: Partial<Prisma.SaleUncheckedCreateInput> = {},
) {
  return prisma.sale.create({
    data: {
      lotId,
      buyerId,
      saleRecordedByAuctionHouseId,
      finalPrice: 100,
      status: SaleStatus.CONFIRMED,
      ...overrides,
    },
  });
}

export async function createStream(
  prisma: PrismaService,
  auctionId: string,
  overrides: Partial<Prisma.StreamUncheckedCreateInput> = {},
) {
  return prisma.stream.create({
    data: {
      auctionId,
      status: StreamStatus.WAITING,
      ...overrides,
    },
  });
}
