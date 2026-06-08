import { Type } from 'class-transformer';
import { LotStatus } from '../../../generated/prisma/enums';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class LotImageUploadDto {
  @IsString()
  fileName!: string;

  @IsString()
  dataUrl!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateLotDto {
  @IsString()
  code!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  breed?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  sex?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ageMonths?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  initialPrice?: number;

  @IsOptional()
  @IsEnum(LotStatus)
  status?: LotStatus;

  @IsUUID()
  auctionId!: string;

  @IsOptional()
  @IsUUID()
  consignmentId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotImageUploadDto)
  images?: LotImageUploadDto[];
}
