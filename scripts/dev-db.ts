// Banco PostgreSQL local para desenvolvimento/testes (sem Docker). NÃO usar em produção.
// Uso: npm run dev:db   (mantém rodando; Ctrl+C encerra)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dir = process.env.PGDATA_DIR ?? "./.pgdata";
const port = Number(process.env.PGPORT_LOCAL ?? 5433);
const dbName = process.env.PGDB_LOCAL ?? "anamneses";

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });

  if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(dbName);
  } catch {
    /* já existe */
  }
  console.log(`PostgreSQL local pronto: postgresql://postgres:postgres@localhost:${port}/${dbName}`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
