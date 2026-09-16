import { IsEmail, IsString, MinLength } from 'class-validator';

/** Login exclusivo da equipe interna GingApp (userType = 'PLATFORM'). */
export class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
