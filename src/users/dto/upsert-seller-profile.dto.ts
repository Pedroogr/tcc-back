import { IsOptional, IsString } from 'class-validator';

export class UpsertSellerProfileDto {
  @IsOptional()
  @IsString()
  farmName?: string;

  @IsOptional()
  @IsString()
  ruralRegistration?: string;

  @IsOptional()
  @IsString()
  stateRegistration?: string;

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
