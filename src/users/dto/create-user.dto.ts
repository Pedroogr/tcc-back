import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UpsertSellerProfileDto } from './upsert-seller-profile.dto';
import { UpsertBuyerProfileDto } from './upsert-buyer-profile.dto';

export enum UserAccountType {
  BUYER = 'BUYER',
  SELLER = 'SELLER',
}

export class CreateUserDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsEnum(UserAccountType)
  accountType?: UserAccountType;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertSellerProfileDto)
  sellerProfile?: UpsertSellerProfileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertBuyerProfileDto)
  buyerProfile?: UpsertBuyerProfileDto;
}
