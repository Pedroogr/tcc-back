import { Type } from 'class-transformer';
import { IsDivisibleBy, IsNumber, Min } from 'class-validator';

export class CreateBidDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsDivisibleBy(5, { message: 'O lance deve ser multiplo de R$ 5.' })
  amount!: number;
}
