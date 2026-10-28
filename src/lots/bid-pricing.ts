import { Prisma } from '../../generated/prisma/client';

export const BID_STEP = new Prisma.Decimal(5);

export function effectiveBidIncrement(configuredIncrement: Prisma.Decimal) {
  return configuredIncrement.gt(BID_STEP) ? configuredIncrement : BID_STEP;
}

export function minimumBidAmount(
  initialPrice: Prisma.Decimal | null,
  currentWinningAmount: Prisma.Decimal | null,
  configuredIncrement: Prisma.Decimal,
) {
  return currentWinningAmount
    ? currentWinningAmount.plus(effectiveBidIncrement(configuredIncrement))
    : (initialPrice ?? new Prisma.Decimal(0));
}
