import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertBuyerProfileDto {
  @IsString()
  @IsNotEmpty()
  ie!: string;

  @IsString()
  @IsNotEmpty()
  ieUf!: string;
}
