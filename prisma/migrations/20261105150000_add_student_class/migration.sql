-- Turma/série do aluno informada no agendamento (opcional no banco: agendamentos antigos ficam sem valor).
ALTER TABLE "Appointment" ADD COLUMN "studentClass" TEXT;
