# Build stage: build the Astro site against the production PocketBase URL.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY web/ ./
ARG PUBLIC_PB_URL=https://marketplace.bigconfig.ai
ENV PUBLIC_PB_URL=${PUBLIC_PB_URL}
# Astro outputs to ../pocketbase/pb_public by default; override here for the
# isolated build stage.
RUN pnpm run build -- --outDir /out

# Runtime stage: Caddy + Litestream-supervised PocketBase + built static site.
FROM alpine:3.20
ARG TARGETARCH

RUN apk add --no-cache ca-certificates tini

RUN apk add --no-cache --virtual .build-deps curl jq unzip && \
    set -eux && \
    case "$TARGETARCH" in \
        amd64) std_arch=amd64; ls_arch=x86_64 ;; \
        arm64) std_arch=arm64; ls_arch=arm64 ;; \
        *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    \
    caddy_ver=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | jq -r .tag_name | sed 's/^v//') && \
    curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${caddy_ver}/caddy_${caddy_ver}_linux_${std_arch}.tar.gz" \
        | tar -xz -C /usr/local/bin caddy && \
    \
    pb_ver=$(curl -fsSL https://api.github.com/repos/pocketbase/pocketbase/releases/latest | jq -r .tag_name | sed 's/^v//') && \
    curl -fsSL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${pb_ver}/pocketbase_${pb_ver}_linux_${std_arch}.zip" && \
    unzip -j /tmp/pb.zip pocketbase -d /usr/local/bin && \
    rm /tmp/pb.zip && \
    \
    ls_ver=$(curl -fsSL https://api.github.com/repos/benbjohnson/litestream/releases/latest | jq -r .tag_name | sed 's/^v//') && \
    curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${ls_ver}/litestream-${ls_ver}-linux-${ls_arch}.tar.gz" \
        | tar -xz -C /usr/local/bin litestream && \
    \
    hm_ver=$(curl -fsSL https://api.github.com/repos/DarthSim/hivemind/releases/latest | jq -r .tag_name | sed 's/^v//') && \
    curl -fsSL -o /tmp/hm.gz "https://github.com/DarthSim/hivemind/releases/download/v${hm_ver}/hivemind-v${hm_ver}-linux-${std_arch}.gz" && \
    gunzip /tmp/hm.gz && \
    mv /tmp/hm /usr/local/bin/hivemind && \
    chmod +x /usr/local/bin/hivemind && \
    \
    apk del .build-deps

WORKDIR /pb
COPY pocketbase/pb_migrations ./pb_migrations
COPY pocketbase/pb_hooks ./pb_hooks
COPY --from=web /out ./pb_public

COPY Caddyfile.prod /etc/caddy/Caddyfile
COPY litestream.yml /etc/litestream.yml
COPY Procfile.prod /app/Procfile
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/storage"]
EXPOSE 80

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["hivemind", "/app/Procfile"]
