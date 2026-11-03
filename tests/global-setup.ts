import { execSync } from "node:child_process";
import { Client } from "pg";
import { TEST_DB } from "./db-url";

/** Cria o banco de testes (se preciso) e aplica as migrations reais, inclusive as constraints parciais/EXCLUDE. */
export default async function setup() {
  const url = TEST_DB;
  const u = new URL(url);
  const dbName = u.pathname.replace("/", "");
  if (!/test/i.test(dbName)) throw new Error(`Recusando rodar testes em banco sem "test" no nome: ${dbName}`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  admin.search = "";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();

  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
