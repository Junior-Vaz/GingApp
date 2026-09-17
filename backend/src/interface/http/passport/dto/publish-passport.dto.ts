import { IsInt } from 'class-validator';

export class PublishPassportDto {
  @IsInt()
  studentId!: number;
}
