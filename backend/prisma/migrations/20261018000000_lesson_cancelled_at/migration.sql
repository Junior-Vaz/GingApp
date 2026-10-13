-- Aula cancelada: guarda QUANDO foi cancelada, para o app esconder a aula cancelada depois de 2 dias.
ALTER TABLE "Lesson" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Aulas já canceladas: usa a última atualização como melhor estimativa do momento do cancelamento.
UPDATE "Lesson" SET "cancelledAt" = "updatedAt" WHERE "status" = 'INACTIVE' AND "cancelledAt" IS NULL;
