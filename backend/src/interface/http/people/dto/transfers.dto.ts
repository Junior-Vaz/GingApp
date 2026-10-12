import { TransferContestReason } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { IsImageRef } from '../../../../shared/uploads/image-ref';

/** POST /transfers: um identificador da pessoa (personId, codigo GingApp ou CPF). O grupo destino e o do token. */
export class CreateTransferDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  personId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  gingappCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  document?: string;

  /** Grupo de origem, quando a pessoa esta matriculada em mais de um. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromOrganizationId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

export class ListTransfersQueryDto {
  @IsOptional()
  @IsIn(['sent', 'received'])
  direction?: 'sent' | 'received';
}

export class ContestTransferDto {
  @IsEnum(TransferContestReason)
  reason!: TransferContestReason;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** PATCH /people/me: a propria pessoa edita a ficha (propaga nome/foto/contato as matriculas). null limpa os opcionais. */
export class UpdateMyPersonDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  nickname?: string | null;

  @IsOptional()
  @IsImageRef()
  photo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;
}
