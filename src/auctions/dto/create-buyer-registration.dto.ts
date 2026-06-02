import { IsOptional, IsString } from 'class-validator';

export class CreateBuyerRegistrationDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
