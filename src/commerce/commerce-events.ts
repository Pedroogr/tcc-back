// Shared realtime payload contracts for the commerce gateway (RF06-RF10).
//
// Privacy rules encoded by these types:
// - Bid updates never carry a bidder identity. A sold lot reveals only the
//   winner's display name after the office confirms the sale.
// - Only the owner office receives `OfficeBidPayload`, which carries the bidder.
// - Only the winning buyer receives `SaleWonPayload`.

export type OfficeBidPayload = {
  bidId: string;
  lotId: string;
  amount: string;
  createdAt: Date;
  bidder: { id: string; name: string };
};

export type BidPriceUpdatedPayload = {
  lotId: string;
  amount: string;
  createdAt: Date;
};

export type LotSoldPayload = {
  lotId: string;
  finalPrice: string;
  soldAt: Date;
};

export type LotWinnerAnnouncedPayload = LotSoldPayload & {
  lotCode: string;
  lotTitle: string;
  winnerName: string;
};

export type SaleWonPayload = {
  saleId: string;
  lotId: string;
  lotCode: string;
  lotTitle: string;
  auctionId: string;
  auctionTitle: string;
  finalPrice: string;
};
