import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchOperatorBuyersDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  query?: string;
}
