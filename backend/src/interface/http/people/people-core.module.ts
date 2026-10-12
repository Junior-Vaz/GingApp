import { Module } from '@nestjs/common';
import { PersonFichaService } from './person-ficha.service';
import { PersonIdentityService } from './person-identity.service';

/**
 * Nucleo da ficha unica, SEM controllers e sem depender de StudentsModule (evita ciclo): o StudentsModule importa
 * este modulo (cadastro sem duplicar, ficha da equipe) e o PeopleModule (rotas /people) importa os dois.
 */
@Module({
  providers: [PersonIdentityService, PersonFichaService],
  exports: [PersonIdentityService, PersonFichaService],
})
export class PeopleCoreModule {}
