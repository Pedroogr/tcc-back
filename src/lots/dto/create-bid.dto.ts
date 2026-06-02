import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class CreateBidDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;
}
