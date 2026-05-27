import { AuctionMode, AuctionStatus } from '../../../generated/prisma/enums';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateAuctionDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsEnum(AuctionStatus)
  status?: AuctionStatus;

  @IsOptional()
  @IsEnum(AuctionMode)
  mode?: AuctionMode;

  @IsOptional()
  @IsString()
  auctionHouseId?: string;
}
