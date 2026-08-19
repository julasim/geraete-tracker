# Geräte-Tracker — Abbild für den Mini-PC
#
# Zwei Stufen: Die erste baut (braucht TypeScript, Vite, alle Werkzeuge), die
# zweite enthält nur das Ergebnis. Das spart nicht nur Platz — was nicht im
# Abbild liegt, kann auch nicht angegriffen werden.

# ── Stufe 1: bauen ──────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS bau

WORKDIR /bau

# Erst die Abhängigkeiten, dann der Code: Solange sich package-lock.json nicht
# ändert, holt Docker die Installation aus dem Zwischenspeicher. Andersherum
# würde jede Codeänderung ein volles "npm ci" auslösen.
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/

# --ignore-scripts unterdrückt das postinstall (das web/ installiert); das
# holen wir gleich selbst nach. Sonst liefe es, bevor web/package.json da ist.
RUN npm ci --ignore-scripts && npm --prefix web ci

COPY tsconfig.json ./
COPY src ./src
COPY web ./web

RUN npm run build

# Für die zweite Stufe: nur die Abhängigkeiten, die zur Laufzeit gebraucht
# werden. Vite, TypeScript und Vitest bleiben draußen.
RUN npm ci --omit=dev --ignore-scripts

# ── Stufe 2: laufen ─────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS laufzeit

# tini fängt Signale ab und räumt Zombie-Prozesse weg. Ohne einen richtigen
# init-Prozess bekommt Node kein SIGTERM und "docker compose down" wartet
# jedes Mal zehn Sekunden, bis es hart abgeschossen wird.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=bau --chown=node:node /bau/node_modules ./node_modules
COPY --from=bau --chown=node:node /bau/dist ./dist
COPY --from=bau --chown=node:node /bau/package.json ./package.json

# Fotos und Anhänge. Der Ordner gehört node (uid 1000) — liegt hier ein
# Verzeichnis vom Host darüber, das root gehört, scheitert das Hochladen mit
# EACCES, und die Meldung führt in die Irre.
RUN mkdir -p /data && chown node:node /data
ENV DATA_PATH=/data

# Nicht als root. Ein Fehler in der Anwendung soll nicht gleich die ganze
# Maschine kosten.
USER node

EXPOSE 3000

# Prüft sich selbst — kein curl nötig, Node kann das seit Version 18 allein.
# compose wartet damit auf "healthy", bevor es die App als bereit meldet.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
