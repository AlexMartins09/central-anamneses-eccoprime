// Gera valores seguros para AUTH_SECRET, ENCRYPTION_KEY e CRON_SECRET.
import { randomBytes } from "node:crypto";
console.log(`AUTH_SECRET=${randomBytes(48).toString("base64url")}`);
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`CRON_SECRET=${randomBytes(32).toString("hex")}`);
