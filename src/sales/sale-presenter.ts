// Role-specific, explicitly-built projections of a confirmed sale (RF08-RF10).
//
// Contacts are only ever attached to the perspective allowed to see them:
// - Office sees both buyer and seller (or the responsible auction house).
// - Winning buyer sees only the responsible party (seller, or the office when
//   the lot has no consignment).
// - Seller sees only the buyer.

export type ContactView = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

export type ResponsibleContactView = ContactView & {
  kind: 'SELLER' | 'AUCTION_HOUSE';
};

export type SaleBaseView = {
  id: string;
  lotId: string;
  lotCode: string;
  lotTitle: string;
  auctionId: string;
  auctionTitle: string;
  finalPrice: string;
  soldAt: Date;
  status: string;
  notes: string | null;
};

export type OfficeSaleView = SaleBaseView & {
  buyer: ContactView;
  seller: ContactView | null;
  responsible: ResponsibleContactView;
};

export type WinnerSaleView = SaleBaseView & {
  responsible: ResponsibleContactView;
};

export type SellerSaleView = SaleBaseView & {
  buyer: ContactView;
};

// Normalized aggregate the service assembles from Prisma results before
// presenting. Keeping presentation pure makes each perspective easy to audit.
export type SaleAggregate = {
  id: string;
  lot: { id: string; code: string; title: string };
  auction: { id: string; title: string };
  finalPrice: string;
  soldAt: Date;
  status: string;
  notes: string | null;
  buyer: ContactView;
  seller: ContactView | null;
  auctionHouse: ContactView;
};

function baseView(sale: SaleAggregate): SaleBaseView {
  return {
    id: sale.id,
    lotId: sale.lot.id,
    lotCode: sale.lot.code,
    lotTitle: sale.lot.title,
    auctionId: sale.auction.id,
    auctionTitle: sale.auction.title,
    finalPrice: sale.finalPrice,
    soldAt: sale.soldAt,
    status: sale.status,
    notes: sale.notes,
  };
}

function responsibleContact(sale: SaleAggregate): ResponsibleContactView {
  if (sale.seller) {
    return { kind: 'SELLER', ...sale.seller };
  }

  return { kind: 'AUCTION_HOUSE', ...sale.auctionHouse };
}

export function presentOfficeSale(sale: SaleAggregate): OfficeSaleView {
  return {
    ...baseView(sale),
    buyer: sale.buyer,
    seller: sale.seller,
    responsible: responsibleContact(sale),
  };
}

export function presentWinnerSale(sale: SaleAggregate): WinnerSaleView {
  return {
    ...baseView(sale),
    responsible: responsibleContact(sale),
  };
}

export function presentSellerSale(sale: SaleAggregate): SellerSaleView {
  return {
    ...baseView(sale),
    buyer: sale.buyer,
  };
}
