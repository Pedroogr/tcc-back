jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { Prisma } from '../../generated/prisma/client';
import { LotStatus, SaleStatus } from '../../generated/prisma/enums';
import type { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import type { CommerceGateway } from '../commerce/commerce.gateway';
import type { PrismaService } from '../prisma/prisma.service';
import { SalesService } from './sales.service';

const officeActor = {
  type: 'AUCTION_HOUSE',
  auctionHouse: {
    id: 'house-1',
    name: 'Casa de Remates',
    email: 'casa@example.test',
    status: 'ACTIVE',
    mustChangePassword: false,
  },
} as unknown as AuthenticatedActor;

function buildContext(
  options: {
    lot?: Record<string, unknown> | null;
    winningBid?: Record<string, unknown> | null;
  } = {},
) {
  const winningBid =
    options.winningBid === undefined
      ? {
          id: 'bid-1',
          amount: new Prisma.Decimal('1100'),
          bidderId: 'buyer-1',
          bidder: {
            id: 'buyer-1',
            name: 'Comprador Vencedor',
            email: 'comprador@example.test',
            phone: '11999999999',
          },
        }
      : options.winningBid;

  const lot =
    options.lot === undefined
      ? {
          id: 'lot-1',
          code: 'L-01',
          title: 'Lote Premium',
          status: LotStatus.IN_AUCTION,
          auction: {
            id: 'auction-1',
            title: 'Remate de Outono',
            auctionHouseId: 'house-1',
            auctionHouse: {
              id: 'house-1',
              name: 'Casa de Remates',
              email: 'casa@example.test',
              phone: '1140000000',
            },
          },
          consignment: null,
          sale: null,
        }
      : options.lot;

  const createdSale = {
    id: 'sale-1',
    lotId: 'lot-1',
    buyerId: 'buyer-1',
    saleRecordedByAuctionHouseId: 'house-1',
    finalPrice: new Prisma.Decimal('1100'),
    status: SaleStatus.CONFIRMED,
    soldAt: new Date('2026-09-02T12:00:00.000Z'),
    notes: 'Frete por conta do comprador',
  };

  const tx = {
    lot: {
      findUnique: jest.fn().mockResolvedValue(lot),
      update: jest.fn().mockResolvedValue({}),
    },
    bid: {
      findFirst: jest.fn().mockResolvedValue(winningBid),
    },
    sale: {
      create: jest.fn().mockResolvedValue(createdSale),
    },
  };

  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
  } as unknown as PrismaService;

  const commerceGateway = {
    emitLotSold: jest.fn(),
    emitSaleWon: jest.fn(),
  } as unknown as CommerceGateway;

  const service = new SalesService(prisma, commerceGateway);

  return { service, prisma, tx, commerceGateway, winningBid, createdSale };
}

describe('SalesService.create', () => {
  it('records the winning bid as a sale, marks the lot sold and notifies only the winner', async () => {
    const { service, tx, commerceGateway, winningBid } = buildContext();

    const sale = await service.create(
      { lotId: 'lot-1', notes: 'Frete por conta do comprador' },
      officeActor,
    );

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lotId: 'lot-1',
          buyerId: 'buyer-1',
          saleRecordedByAuctionHouseId: 'house-1',
          finalPrice: (winningBid as { amount: Prisma.Decimal }).amount,
        }),
      }),
    );
    expect(tx.lot.update).toHaveBeenCalledWith({
      where: { id: 'lot-1' },
      data: { status: LotStatus.SOLD },
    });
    expect(commerceGateway.emitLotSold).toHaveBeenCalledTimes(1);
    expect(commerceGateway.emitSaleWon).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ saleId: sale.id, lotId: 'lot-1' }),
    );
    expect(commerceGateway.emitSaleWon).toHaveBeenCalledTimes(1);
  });

  it('rejects confirmation by a common user without touching the database', async () => {
    const { service, prisma, commerceGateway } = buildContext();
    const buyerActor = {
      type: 'USER',
      user: { id: 'buyer-1', email: 'comprador@example.test' },
    } as unknown as AuthenticatedActor;

    await expect(
      service.create({ lotId: 'lot-1' }, buyerActor),
    ).rejects.toBeDefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(commerceGateway.emitLotSold).not.toHaveBeenCalled();
    expect(commerceGateway.emitSaleWon).not.toHaveBeenCalled();
  });

  it('rejects confirmation from an office that does not own the auction', async () => {
    const { service, tx, commerceGateway } = buildContext({
      lot: {
        id: 'lot-1',
        code: 'L-01',
        title: 'Lote Premium',
        status: LotStatus.IN_AUCTION,
        auction: {
          id: 'auction-1',
          title: 'Remate de Outono',
          auctionHouseId: 'house-999',
          auctionHouse: {
            id: 'house-999',
            name: 'Outra Casa',
            email: 'outra@example.test',
            phone: null,
          },
        },
        consignment: null,
        sale: null,
      },
    });

    await expect(
      service.create({ lotId: 'lot-1' }, officeActor),
    ).rejects.toBeDefined();
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.lot.update).not.toHaveBeenCalled();
    expect(commerceGateway.emitSaleWon).not.toHaveBeenCalled();
  });

  it('rejects confirmation when the lot has no winning bid', async () => {
    const { service, tx, commerceGateway } = buildContext({ winningBid: null });

    await expect(
      service.create({ lotId: 'lot-1' }, officeActor),
    ).rejects.toBeDefined();
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.lot.update).not.toHaveBeenCalled();
    expect(commerceGateway.emitSaleWon).not.toHaveBeenCalled();
  });

  it('rejects confirmation when the lot is not in auction', async () => {
    const { service, tx, commerceGateway } = buildContext({
      lot: {
        id: 'lot-1',
        code: 'L-01',
        title: 'Lote Premium',
        status: LotStatus.AVAILABLE,
        auction: {
          id: 'auction-1',
          title: 'Remate de Outono',
          auctionHouseId: 'house-1',
          auctionHouse: {
            id: 'house-1',
            name: 'Casa de Remates',
            email: 'casa@example.test',
            phone: '1140000000',
          },
        },
        consignment: null,
        sale: null,
      },
    });

    await expect(
      service.create({ lotId: 'lot-1' }, officeActor),
    ).rejects.toBeDefined();
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(commerceGateway.emitSaleWon).not.toHaveBeenCalled();
  });

  it('rejects confirmation when the lot already has a sale', async () => {
    const { service, tx, commerceGateway } = buildContext({
      lot: {
        id: 'lot-1',
        code: 'L-01',
        title: 'Lote Premium',
        status: LotStatus.IN_AUCTION,
        auction: {
          id: 'auction-1',
          title: 'Remate de Outono',
          auctionHouseId: 'house-1',
          auctionHouse: {
            id: 'house-1',
            name: 'Casa de Remates',
            email: 'casa@example.test',
            phone: '1140000000',
          },
        },
        consignment: null,
        sale: { id: 'existing-sale' },
      },
    });

    await expect(
      service.create({ lotId: 'lot-1' }, officeActor),
    ).rejects.toBeDefined();
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(commerceGateway.emitSaleWon).not.toHaveBeenCalled();
  });
});
