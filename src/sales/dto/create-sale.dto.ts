import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateSaleDto {
  @IsUUID()
  lotId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
