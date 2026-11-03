#!/usr/bin/env bash
# Backup lógico do PostgreSQL (formato custom do pg_dump, compactado).
# Uso:  DATABASE_URL="postgres://..." npm run db:backup
# Restaurar: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL_DESTINO" backups/<arquivo>.dump
# Requer pg_dump instalado (versão >= à do servidor). Guarde o arquivo fora do servidor (ex.: Drive criptografado).
set -euo pipefail

: "${DATABASE_URL:?Defina DATABASE_URL (use a External Database URL do Render)}"
mkdir -p backups
FILE="backups/anamneses-$(date +%Y%m%d-%H%M%S).dump"
# remove parâmetros específicos do Prisma (?schema=public) que o pg_dump não entende
CLEAN_URL="${DATABASE_URL%%\?*}"
pg_dump --format=custom --no-owner --compress=9 --file="$FILE" "$CLEAN_URL"
echo "Backup criado: $FILE ($(du -h "$FILE" | cut -f1))"
