import { IsEnum, IsOptional, IsString } from 'class-validator';
import { BuyerRegistrationStatus } from '../../../generated/prisma/enums';

export class ReviewBuyerRegistrationDto {
  @IsEnum(BuyerRegistrationStatus)
  status!: BuyerRegistrationStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
