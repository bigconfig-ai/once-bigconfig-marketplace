# marketplace.bigconfig.ai is a redirect and nothing else. There is no build
# stage: the image is Caddy plus one config file. The base image's default
# command already runs `caddy run --config /etc/caddy/Caddyfile`.
FROM caddy:2-alpine

COPY Caddyfile.prod /etc/caddy/Caddyfile

EXPOSE 80
