import { Type } from 'class-transformer';
import {
  IsDivisibleBy,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
} from 'class-validator';

export class CreateOperatorBidDto {
  @IsString()
  @IsNotEmpty()
  expectedLotId!: string;

  @IsString()
  @IsNotEmpty()
  buyerId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsDivisibleBy(5, { message: 'O lance deve ser multiplo de R$ 5.' })
  amount!: number;
}
