import { Equals } from 'class-validator';

/** POST /data-deletion-requests/:id/anonymize: confirmacao explicita (a acao e IRREVERSIVEL). */
export class AnonymizeDataDeletionRequestDto {
  @Equals(true, { message: 'Confirme a anonimização enviando confirm: true.' })
  confirm!: true;
}
