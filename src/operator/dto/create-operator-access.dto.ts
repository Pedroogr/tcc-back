import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateOperatorAccessDto {
  @IsString()
  @IsNotEmpty()
  auctionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;
}
