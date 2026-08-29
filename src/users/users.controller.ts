import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpsertSellerProfileDto } from './dto/upsert-seller-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { UserAccessService } from './user-access.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userAccessService: UserAccessService,
  ) {}

  @Post()
  create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.usersService.findOne(request.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/seller-profile')
  upsertSellerProfile(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpsertSellerProfileDto,
  ) {
    return this.usersService.upsertSellerProfile(request.user.id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/buyer-profile')
  upsertBuyerProfile(@Req() request: AuthenticatedRequest) {
    return this.usersService.upsertBuyerProfile(request.user.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    this.userAccessService.assertSelfOrAdmin(request.user, id);
    return this.usersService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    this.userAccessService.assertSelfOrAdmin(request.user, id);
    return this.usersService.update(id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    this.userAccessService.assertSelfOrAdmin(request.user, id);
    return this.usersService.remove(id);
  }
}
