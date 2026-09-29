import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { IsPublicEmailDomain } from '../../common/email-validation';

export class RegisterAuctionHouseInviteDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsEmail()
  @IsPublicEmailDomain()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'Municipio obrigatorio' })
  city!: string;

  @IsString()
  @IsNotEmpty()
  state!: string;

  @IsOptional()
  @IsString()
  country?: string;
}
