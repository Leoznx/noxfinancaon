#!/bin/sh
set -eu

# O bind mount de /app/data pode chegar pertencendo ao root do host. Corrige a
# propriedade a cada inicialização e só então executa o worker como usuário
# não privilegiado, garantindo que a sessão renovada possa ser persistida.
if [ -d /app/data ]; then
  chown -R nox:nox /app/data
fi

exec runuser -u nox -- "$@"
