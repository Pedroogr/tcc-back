import { IsNotEmpty, IsString } from 'class-validator';

export class OperatorLoginDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}
