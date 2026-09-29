import { IsString } from 'class-validator';

export class CreateGestureEventDto {
  @IsString()
  eventId!: string;

  @IsString()
  capturedAt!: string;

  @IsString()
  personBox!: string;
}
