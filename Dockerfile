# The app shells out to two real binaries, which is why it cannot run on a
# serverless platform: tectonic recompiles a spliced LaTeX CV, and LibreOffice
# converts a rewritten Word file to PDF. Both are installed here, so the image
# runs the same on a laptop, Render, Railway, Fly or a bare VPS.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# openssl is needed by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

FROM deps AS build
WORKDIR /app
COPY . .
# The build reads DATABASE_URL through the Prisma schema even though it never
# opens the database; a placeholder keeps it from failing at image-build time.
ENV DATABASE_URL="file:/tmp/build.db"
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# LibreOffice Writer alone, not the whole suite: it carries the soffice binary
# the .docx path calls, and leaves out Calc, Impress and Base. Liberation fonts
# stand in for the Microsoft ones a Word CV asks for, so a converted document
# keeps its metrics instead of falling back to something much wider.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui \
      fonts-liberation \
      fonts-dejavu-core \
      openssl \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Tectonic is a single static binary and is not packaged for Debian stable, so
# it is fetched from the project's releases.
#
# Not through the upstream shell installer: that script resolves the host triple
# itself and asks for aarch64-unknown-linux-gnu on an ARM machine, which has
# never been published — the only ARM Linux build is musl. Building this image
# on an Apple Silicon laptop therefore died on a 404 while the same Dockerfile
# was fine on an x86 build host, which is a miserable thing to discover on
# deploy day.
#
# musl is used for both architectures because it exists for both and is
# statically linked, and the version is pinned so a release upstream cannot
# change what a redeploy installs mid-study.
ARG TARGETARCH
ARG TECTONIC_VERSION=0.17.0
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) triple=x86_64-unknown-linux-musl ;; \
      arm64) triple=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl --proto '=https' --tlsv1.2 -fsSL \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${triple}.tar.gz" \
      | tar -xz -C /usr/local/bin tectonic; \
    chmod +x /usr/local/bin/tectonic; \
    tectonic --version

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
# The researcher's own scripts, which have to run against the deployed
# database rather than a laptop copy of it: provisioning the participant
# accounts, exporting the study data, pseudonymising it. Without these in the
# image there is no way to create a login on the running server.
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Everything that has to survive a redeploy lives on one mounted volume: the
# SQLite file, and Tectonic's package cache. Without the cache on the volume,
# the first .tex export after every deploy re-downloads the LaTeX packages it
# needs and takes minutes while a participant waits.
ENV DATABASE_URL="file:/data/dev.db"
ENV TECTONIC_CACHE_DIR=/data/tectonic-cache
# LibreOffice writes a user profile on first run and fails if HOME is read-only.
ENV HOME=/tmp
RUN mkdir -p /data

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
