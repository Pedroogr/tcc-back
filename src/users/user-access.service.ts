import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

@Injectable()
export class UserAccessService {
  assertSelfOrAdmin(requestUser: AuthenticatedUser, targetId: string): void {
    if (
      requestUser.platformRole === 'SYSTEM_ADMIN' ||
      requestUser.id === targetId
    ) {
      return;
    }

    throw new ForbiddenException('Acesso negado');
  }
}
