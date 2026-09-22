import { BadRequestException } from '@nestjs/common';

type BuyerProfileWithIe = {
  ie: string | null;
  ieUf: string | null;
};

export function assertBuyerHasIe(
  profile: BuyerProfileWithIe | null,
): asserts profile is BuyerProfileWithIe {
  if (!profile?.ie || !profile.ieUf) {
    throw new BadRequestException(
      'Comprador precisa informar IE e UF antes da aprovacao.',
    );
  }
}
