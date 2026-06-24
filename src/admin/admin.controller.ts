import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { AdminService } from './admin.service';
import { CreateOfficeInviteDto } from './dto/create-office-invite.dto';

@UseGuards(SystemAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('office-invites')
  createOfficeInvite(@Body() body: CreateOfficeInviteDto) {
    return this.adminService.createOfficeInvite(body);
  }

  @Get('office-invites')
  listOfficeInvites() {
    return this.adminService.listOfficeInvites();
  }

  @Delete('office-invites/:id')
  revokeOfficeInvite(@Param('id') id: string) {
    return this.adminService.revokeOfficeInvite(id);
  }
}
