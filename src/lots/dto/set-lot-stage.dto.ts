import { LotStatus } from '../../../generated/prisma/enums';
import { IsIn } from 'class-validator';

export class SetLotStageDto {
  @IsIn([LotStatus.AVAILABLE, LotStatus.IN_AUCTION])
  status!: 'AVAILABLE' | 'IN_AUCTION';
}
