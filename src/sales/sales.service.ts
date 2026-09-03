import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { BidStatus, LotStatus, SaleStatus } from '../../generated/prisma/enums';
import { AuthenticatedActor } from '../auth/actor-jwt-auth.guard';
import { CommerceGateway } from '../commerce/commerce.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import {
  ContactView,
  OfficeSaleView,
  SaleAggregate,
  SellerSaleView,
  WinnerSaleView,
  presentOfficeSale,
  presentSellerSale,
  presentWinnerSale,
} from './sale-presenter';

const contactSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
} satisfies Prisma.UserSelect;

const saleQuerySelect = {
  id: true,
  finalPrice: true,
  soldAt: true,
  status: true,
  notes: true,
  buyer: { select: contactSelect },
  saleRecordedByAuctionHouse: { select: contactSelect },
  lot: {
    select: {
      id: true,
      code: true,
      title: true,
      auction: { select: { id: true, title: true } },
      consignment: { select: { seller: { select: contactSelect } } },
    },
  },
} satisfies Prisma.SaleSelect;

type SaleQueryResult = Prisma.SaleGetPayload<{
  select: typeof saleQuerySelect;
}>;

type ContactSource = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceGateway: CommerceGateway,
  ) {}

  async create(
    dto: CreateSaleDto,
    actor: AuthenticatedActor,
  ): Promise<OfficeSaleView> {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas o escritorio pode confirmar a venda de um lote',
      );
    }

    const auctionHouseId = actor.auctionHouse.id;

    const { sale, aggregate } = await this.prisma.$transaction(async (tx) => {
      const lot = await tx.lot.findUnique({
        where: { id: dto.lotId },
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          auction: {
            select: {
              id: true,
              title: true,
              auctionHouseId: true,
              auctionHouse: {
                select: { id: true, name: true, email: true, phone: true },
              },
            },
          },
          consignment: {
            select: {
              seller: {
                select: { id: true, name: true, email: true, phone: true },
              },
            },
          },
          sale: { select: { id: true } },
        },
      });

      if (!lot || !lot.auction) {
        throw new NotFoundException('Lote nao encontrado');
      }

      if (lot.auction.auctionHouseId !== auctionHouseId) {
        throw new ForbiddenException(
          'Escritorio nao pode confirmar a venda de um lote de outro escritorio',
        );
      }

      if (lot.status !== LotStatus.IN_AUCTION) {
        throw new BadRequestException(
          'Lote nao esta em pista para confirmar a venda',
        );
      }

      if (lot.sale) {
        throw new ConflictException('Este lote ja possui uma venda confirmada');
      }

      const winningBid = await tx.bid.findFirst({
        where: { lotId: dto.lotId, status: BidStatus.WINNING },
        orderBy: { amount: 'desc' },
        select: {
          id: true,
          amount: true,
          bidderId: true,
          bidder: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      });

      if (!winningBid) {
        throw new BadRequestException(
          'Lote nao possui lance vencedor para confirmar a venda',
        );
      }

      const created = await tx.sale.create({
        data: {
          lotId: dto.lotId,
          buyerId: winningBid.bidderId,
          saleRecordedByAuctionHouseId: auctionHouseId,
          finalPrice: winningBid.amount,
          status: SaleStatus.CONFIRMED,
          notes: dto.notes ?? null,
        },
      });

      await tx.lot.update({
        where: { id: dto.lotId },
        data: { status: LotStatus.SOLD },
      });

      const aggregate: SaleAggregate = {
        id: created.id,
        lot: { id: lot.id, code: lot.code, title: lot.title },
        auction: { id: lot.auction.id, title: lot.auction.title },
        finalPrice: created.finalPrice.toString(),
        soldAt: created.soldAt,
        status: created.status,
        notes: created.notes ?? null,
        buyer: this.toContact(winningBid.bidder),
        seller: lot.consignment?.seller
          ? this.toContact(lot.consignment.seller)
          : null,
        auctionHouse: this.toContact(lot.auction.auctionHouse),
      };

      return { sale: created, aggregate };
    });

    this.commerceGateway.emitLotSold(aggregate.auction.id, {
      lotId: aggregate.lot.id,
      finalPrice: aggregate.finalPrice,
      soldAt: sale.soldAt,
    });
    this.commerceGateway.emitSaleWon(sale.buyerId, {
      saleId: aggregate.id,
      lotId: aggregate.lot.id,
      lotCode: aggregate.lot.code,
      lotTitle: aggregate.lot.title,
      auctionId: aggregate.auction.id,
      auctionTitle: aggregate.auction.title,
      finalPrice: aggregate.finalPrice,
    });

    return presentOfficeSale(aggregate);
  }

  async findForAuctionHouse(
    actor: AuthenticatedActor,
  ): Promise<OfficeSaleView[]> {
    if (actor.type !== 'AUCTION_HOUSE') {
      throw new ForbiddenException(
        'Apenas o escritorio pode consultar as vendas do remate',
      );
    }

    const sales = await this.prisma.sale.findMany({
      where: {
        status: SaleStatus.CONFIRMED,
        saleRecordedByAuctionHouseId: actor.auctionHouse.id,
      },
      orderBy: { soldAt: 'desc' },
      select: saleQuerySelect,
    });

    return sales.map((sale) => presentOfficeSale(this.toAggregate(sale)));
  }

  async findWonByUser(actor: AuthenticatedActor): Promise<WinnerSaleView[]> {
    if (actor.type !== 'USER') {
      throw new ForbiddenException(
        'Apenas usuarios podem consultar seus arremates',
      );
    }

    const sales = await this.prisma.sale.findMany({
      where: {
        status: SaleStatus.CONFIRMED,
        buyerId: actor.user.id,
      },
      orderBy: { soldAt: 'desc' },
      select: saleQuerySelect,
    });

    return sales.map((sale) => presentWinnerSale(this.toAggregate(sale)));
  }

  async findSoldBySeller(actor: AuthenticatedActor): Promise<SellerSaleView[]> {
    if (actor.type !== 'USER') {
      throw new ForbiddenException(
        'Apenas usuarios podem consultar suas vendas',
      );
    }

    const sales = await this.prisma.sale.findMany({
      where: {
        status: SaleStatus.CONFIRMED,
        lot: { consignment: { sellerId: actor.user.id } },
      },
      orderBy: { soldAt: 'desc' },
      select: saleQuerySelect,
    });

    return sales.map((sale) => presentSellerSale(this.toAggregate(sale)));
  }

  private toAggregate(sale: SaleQueryResult): SaleAggregate {
    return {
      id: sale.id,
      lot: {
        id: sale.lot.id,
        code: sale.lot.code,
        title: sale.lot.title,
      },
      auction: {
        id: sale.lot.auction?.id ?? '',
        title: sale.lot.auction?.title ?? '',
      },
      finalPrice: sale.finalPrice.toString(),
      soldAt: sale.soldAt,
      status: sale.status,
      notes: sale.notes ?? null,
      buyer: this.toContact(sale.buyer),
      seller: sale.lot.consignment?.seller
        ? this.toContact(sale.lot.consignment.seller)
        : null,
      auctionHouse: this.toContact(sale.saleRecordedByAuctionHouse),
    };
  }

  private toContact(source: ContactSource): ContactView {
    return {
      id: source.id,
      name: source.name,
      email: source.email,
      phone: source.phone ?? null,
    };
  }
}
