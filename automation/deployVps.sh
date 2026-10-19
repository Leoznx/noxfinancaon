#!/usr/bin/env bash
# Implanta o worker de crédito NESTA VPS: confere que nenhuma consulta está em andamento, guarda
# a imagem atual para rollback, reconstrói e recria SOMENTE o worker (o compose desta pasta).
#
# Uso (na VPS, dentro do checkout do repositório, depois de `git pull --ff-only`):
#     bash automation/deployVps.sh
#
# Nenhum segredo é lido ou impresso. O .env e a pasta data/ (sessão da Loft) não são tocados.
set -euo pipefail
cd "$(dirname "$0")"

CONTAINER="${CONTAINER:-nox-automacao-credpago}"
IMAGE="${IMAGE:-nox-automacao-credpago:latest}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"

health() { curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null || true; }

ativas="$(health | grep -o '"activeConsultations":[0-9]*' | cut -d: -f2 || true)"
echo "== consultas em andamento: ${ativas:-?}"
if [ "${ativas:-0}" != "0" ]; then
  echo "ABORTANDO: há consulta em andamento; espere terminar e rode de novo." >&2
  exit 1
fi

versao="$(git rev-parse --short HEAD)"
echo "== versão a implantar: ${versao}"
export AUTOMATION_VERSION="${versao}" DEPLOY_VERSION="${versao}"

# Rollback: a imagem em uso fica guardada com outra etiqueta antes de ser substituída.
if docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  rollback="nox-automacao-credpago:pre-${versao}-$(date +%Y%m%d%H%M)"
  docker tag "${IMAGE}" "${rollback}"
  echo "== imagem atual guardada para rollback: ${rollback}"
fi

docker compose build </dev/null
docker compose up -d </dev/null

echo "== aguardando o worker responder em ${HEALTH_URL} ..."
for _ in $(seq 1 40); do
  if [ -n "$(health)" ]; then break; fi
  sleep 3
done

docker compose ps </dev/null
health
echo
docker compose logs --tail=25 credpago-worker </dev/null
echo "== concluído: versão ${versao}. Para voltar atrás: docker tag <imagem guardada> ${IMAGE} && docker compose up -d --no-build"
