import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, Min } from 'class-validator';

export class CreateOfficeInviteDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
