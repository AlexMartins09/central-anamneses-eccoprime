-- Une "Ensino Fundamental 2" e "Ensino Médio" em um único segmento (a mesma psicóloga atende os dois).
-- Em bancos novos os segmentos ainda não existem (o seed cria direto a versão unificada): nada a fazer.
-- Em bancos existentes: move psicólogas, regras, horários e agendamentos do Médio para o Fundamental 2,
-- renomeia o segmento e retira o Médio da lista (exclusão lógica, o histórico é preservado).
DO $$
DECLARE
  fund2 TEXT;
  medio TEXT;
BEGIN
  SELECT "id" INTO fund2 FROM "SchoolSegment" WHERE "slug" = 'fundamental-2' AND "deletedAt" IS NULL;
  SELECT "id" INTO medio FROM "SchoolSegment" WHERE "slug" = 'ensino-medio' AND "deletedAt" IS NULL;
  IF fund2 IS NULL OR medio IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "PsychologistSegment" ("psychologistId", "segmentId")
    SELECT "psychologistId", fund2 FROM "PsychologistSegment" WHERE "segmentId" = medio
    ON CONFLICT DO NOTHING;
  DELETE FROM "PsychologistSegment" WHERE "segmentId" = medio;

  UPDATE "AvailabilityRule" SET "segmentId" = fund2 WHERE "segmentId" = medio;
  UPDATE "AvailabilitySlot" SET "segmentId" = fund2 WHERE "segmentId" = medio;
  UPDATE "Appointment" SET "segmentId" = fund2 WHERE "segmentId" = medio;

  UPDATE "SchoolSegment"
    SET "name" = 'Ensino Fundamental 2 e Médio',
        "description" = '6º ao 9º ano e 1ª à 3ª série do Ensino Médio',
        "active" = TRUE,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = fund2;

  UPDATE "SchoolSegment"
    SET "active" = FALSE, "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = medio;
END $$;
