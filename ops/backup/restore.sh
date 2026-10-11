#!/bin/sh
# Restore / verificacao de um dump do GingApp (pg_dump -Fc gerado pelo servico "backup").
# POSIX sh; precisa de pg_restore, psql, createdb e dropdb (a imagem postgres:16-alpine ja tem).
#
# Uso:
#   sh restore.sh verify  <arquivo.dump> [--keep]   # RESTAURA NUM BANCO DESCARTAVEL e confere (nao toca no banco real)
#   sh restore.sh replace <arquivo.dump> --yes      # SOBRESCREVE o banco de destino (PGDATABASE) com o dump
#
# Conexao (variaveis padrao do Postgres): PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (padrao gingapp).
# Opcional: VERIFY_DB (nome do banco descartavel do modo verify; padrao gingapp_restore_check).
#
# Codigos de saida: 0 ok; 1 uso/arquivo invalido; 2 dump corrompido; 3 falha no restore; 4 conferencia falhou.
set -eu

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 2 ] || usage
MODE="$1"
DUMP="$2"
shift 2

KEEP=0
YES=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --yes) YES=1 ;;
    *) echo "Argumento desconhecido: $arg" >&2; usage ;;
  esac
done

TARGET_DB="${PGDATABASE:-gingapp}"
VERIFY_DB="${VERIFY_DB:-gingapp_restore_check}"

for tool in pg_restore psql createdb dropdb; do
  command -v "$tool" > /dev/null 2>&1 || { echo "Ferramenta ausente: $tool (rode dentro de um container postgres:16-alpine)" >&2; exit 1; }
done

[ -f "$DUMP" ] || { echo "Arquivo nao encontrado: $DUMP" >&2; exit 1; }
[ -s "$DUMP" ] || { echo "Arquivo vazio: $DUMP" >&2; exit 1; }

echo "[restore] 1/3 integridade do dump (pg_restore --list)"
if ! pg_restore --list "$DUMP" > /dev/null 2>&1; then
  echo "[restore] ERRO: o dump esta corrompido ou nao e um pg_dump -Fc" >&2
  exit 2
fi

# Tabelas do dominio conferidas depois do restore (existencia e contagem).
check_tables() {
  db="$1"
  for table in '"User"' '"Organization"' '"Student"' '"_prisma_migrations"'; do
    count=$(psql -X -At -d "$db" -c "SELECT count(*) FROM $table")
    echo "[restore]   $table: $count linha(s)"
  done
  tables=$(psql -X -At -d "$db" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  [ "$tables" -gt 10 ] || { echo "[restore] ERRO: so $tables tabela(s) no schema public" >&2; return 1; }
  echo "[restore]   tabelas no schema public: $tables"
}

case "$MODE" in
  verify)
    echo "[restore] 2/3 restaurando em banco descartavel \"$VERIFY_DB\" (o banco \"$TARGET_DB\" nao e tocado)"
    [ "$VERIFY_DB" != "$TARGET_DB" ] || { echo "[restore] ERRO: VERIFY_DB nao pode ser o banco real" >&2; exit 1; }
    dropdb --if-exists "$VERIFY_DB"
    createdb "$VERIFY_DB"
    if ! pg_restore --no-owner --no-privileges -d "$VERIFY_DB" "$DUMP"; then
      echo "[restore] ERRO no pg_restore" >&2
      [ "$KEEP" -eq 1 ] || dropdb --if-exists "$VERIFY_DB"
      exit 3
    fi
    echo "[restore] 3/3 conferindo o conteudo restaurado"
    if ! check_tables "$VERIFY_DB"; then
      [ "$KEEP" -eq 1 ] || dropdb --if-exists "$VERIFY_DB"
      exit 4
    fi
    if [ "$KEEP" -eq 1 ]; then
      echo "[restore] OK. Banco \"$VERIFY_DB\" mantido (--keep); apague com: dropdb $VERIFY_DB"
    else
      dropdb --if-exists "$VERIFY_DB"
      echo "[restore] OK. Banco descartavel removido."
    fi
    ;;
  replace)
    if [ "$YES" -ne 1 ]; then
      echo "[restore] replace SOBRESCREVE o banco \"$TARGET_DB\". Pare o backend antes e rode de novo com --yes." >&2
      exit 1
    fi
    echo "[restore] 2/3 sobrescrevendo \"$TARGET_DB\" (pg_restore --clean --if-exists)"
    if ! pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET_DB" "$DUMP"; then
      echo "[restore] ERRO no pg_restore (o banco pode estar parcialmente restaurado; refaca ou volte a um dump anterior)" >&2
      exit 3
    fi
    echo "[restore] 3/3 conferindo o conteudo restaurado"
    check_tables "$TARGET_DB" || exit 4
    echo "[restore] OK. Suba o backend de novo e confira /api/health."
    ;;
  *)
    usage
    ;;
esac
