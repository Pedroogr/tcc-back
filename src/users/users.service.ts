import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UserRegistrationRole } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserDto) {
    try {
      return await this.prisma.user.create({
        data: await this.toUserCreateData(data),
        select: this.safeUserSelect(),
      });
    } catch (error) {
      this.handleUniqueEmailError(error);
      throw error;
    }
  }

  findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: this.safeUserSelect(),
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.safeUserSelect(),
    });

    if (!user) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    return user;
  }

  async update(id: string, data: UpdateUserDto) {
    await this.findOne(id);

    try {
      return await this.prisma.user.update({
        where: { id },
        data: await this.toUserUpdateData(data),
        select: this.safeUserSelect(),
      });
    } catch (error) {
      this.handleUniqueEmailError(error);
      throw error;
    }
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.user.delete({
      where: { id },
      select: this.safeUserSelect(),
    });
  }

  private async toUserCreateData(
    data: CreateUserDto,
  ): Promise<Prisma.UserCreateInput> {
    const roles = this.resolveRegistrationRoles(data.roles);

    return {
      name: data.name,
      email: data.email,
      passwordHash: await hash(data.password, 10),
      phone: data.phone,
      document: data.document,
      ...(roles.has(UserRegistrationRole.BUYER)
        ? { buyerProfile: { create: {} } }
        : {}),
      ...(roles.has(UserRegistrationRole.SELLER)
        ? {
            sellerProfile: {
              create: this.toSellerProfileData(data),
            },
          }
        : {}),
    };
  }

  private async toUserUpdateData(
    data: UpdateUserDto,
  ): Promise<Prisma.UserUpdateInput> {
    const updateData: Prisma.UserUpdateInput = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      document: data.document,
    };

    if (data.password) {
      updateData.passwordHash = await hash(data.password, 10);
    }

    const roles = data.roles
      ? this.resolveRegistrationRoles(data.roles)
      : new Set<UserRegistrationRole>();

    if (roles.has(UserRegistrationRole.BUYER)) {
      updateData.buyerProfile = {
        upsert: {
          create: {},
          update: {},
        },
      };
    }

    if (roles.has(UserRegistrationRole.SELLER)) {
      updateData.sellerProfile = {
        upsert: {
          create: this.toSellerProfileData(data),
          update: this.toSellerProfileData(data),
        },
      };
    }

    return updateData;
  }

  private toSellerProfileData(
    data: CreateUserDto | UpdateUserDto,
  ): Prisma.SellerProfileCreateWithoutUserInput {
    return {
      ruralRegistration: data.ruralRegistration,
      stateRegistration: data.stateRegistration,
      farmName: data.farmName,
      city: data.city,
      state: data.state,
      country: data.country,
    };
  }

  private resolveRegistrationRoles(roles?: UserRegistrationRole[]) {
    return new Set(roles?.length ? roles : [UserRegistrationRole.BUYER]);
  }

  private safeUserSelect() {
    return {
      id: true,
      name: true,
      email: true,
      phone: true,
      document: true,
      platformRole: true,
      status: true,
      buyerProfile: true,
      sellerProfile: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.UserSelect;
  }

  private handleUniqueEmailError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('E-mail ja cadastrado');
    }
  }
}
