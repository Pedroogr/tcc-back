import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, Min } from 'class-validator';
import { IsPublicEmailDomain } from '../../common/email-validation';

export class CreateOfficeInviteDto {
  @IsOptional()
  @IsEmail()
  @IsPublicEmailDomain()
  email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
