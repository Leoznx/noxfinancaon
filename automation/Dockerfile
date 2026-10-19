# Imagem oficial do Playwright: traz as dependências de sistema do Linux (evita apt
# install manual de dezenas de libs, que é frágil e desatualiza rápido).
#
# As versões do package.json são EXATAS e o package-lock.json é versionado: antes, cada
# rebuild na VPS resolvia "^1.49.1" para o Playwright mais novo do momento, trocando o
# Chromium silenciosamente. O `playwright install` abaixo baixa o navegador da versão
# travada, mesmo que ela seja mais nova que a tag da imagem base.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

# Usuário não-root dedicado — a imagem base já roda como root por padrão.
RUN groupadd --system nox && useradd --system --create-home --gid nox nox

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && \
    npm install --no-save tsx@4.23.15 && \
    npx playwright install chromium --with-deps

COPY *.ts *.mjs ./
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/nox-worker-entrypoint

# Diretório de dados (sessão exportada, se usada) com o dono certo antes de trocar de usuário.
RUN mkdir -p /app/data && chown -R nox:nox /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REPAIR_HEALTH_PORT||3001)+'/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/nox-worker-entrypoint"]
CMD ["npx", "tsx", "supervisor.ts"]
