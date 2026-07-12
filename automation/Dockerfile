# Imagem oficial do Playwright: já traz Chromium + todas as dependências de
# sistema do Linux corretas para essa versão exata (evita apt install manual
# de dezenas de libs, que é frágil e desatualiza rápido). Versão precisa bater
# com "playwright" no package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

# Usuário não-root dedicado — a imagem base já roda como root por padrão.
RUN groupadd --system nox && useradd --system --create-home --gid nox nox

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && \
    npm install --no-save tsx@^4.19.2 && \
    npx playwright install chromium --with-deps

COPY credpagoParser.ts credpagoSelectors.ts credpagoWorker.ts env.ts exportSession.ts logger.ts supabaseAdmin.ts types.ts tsconfig.json ./

# Diretório de dados (sessão exportada, se usada) com o dono certo antes de trocar de usuário.
RUN mkdir -p /app/data && chown -R nox:nox /app

USER nox

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "credpagoWorker.ts"]
