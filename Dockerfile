# ePOS-Brief - image de production
FROM node:22-alpine

# tzdata : fuseaux horaires (heure d'impression, dates des agendas)
RUN apk add --no-cache tzdata

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    EPOS_DATA_DIR=/app/data \
    TZ=Europe/Paris

# Dependances d'abord : cette couche reste en cache tant que package*.json ne change pas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Dossier des donnees (reglages, compte, historique), monte en volume
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]

EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1

CMD ["node", "src/server.js"]
