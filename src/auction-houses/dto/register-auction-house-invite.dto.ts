import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterAuctionHouseInviteDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;
}
