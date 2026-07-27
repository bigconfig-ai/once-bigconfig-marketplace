# marketplace.bigconfig.ai — retired

This host used to serve the BigConfig marketplace: a curated index of BigConfig
packages and ONCE-compatible applications, built on PocketBase with Google SSO,
user submissions, and Litestream replication to S3.

It was retired on 2026-07-27 alongside the Colors rebrand. All that remains is a
Caddy image that permanently redirects every request to
<https://www.bigconfig.ai/>.

The application, its Astro frontend, PocketBase migrations and hooks, and the
`plans/` design documents are all in git history — see the commit that removed
them.

## The data

The PocketBase database held user accounts and their package and application
submissions. It was **not** exported. Litestream stopped replicating when this
deploy went out, so the last synced state is still in the S3 bucket named by the
`LITESTREAM_BUCKET` / `LITESTREAM_PATH` variables that were configured for the
old container. Recovering it means restoring that replica with Litestream; there
is no admin UI any more.

## Layout

```text
.
├── Caddyfile.prod          # /up stays 200 for ONCE; everything else 301s
├── Dockerfile              # caddy:2-alpine + the config, nothing else
└── .github/workflows/      # unchanged: build, push to ghcr, ssh, once update
```

`/up` must keep returning 200. It is the ONCE health check, and it has to be
matched before the catch-all redirect or the platform marks the app unhealthy.

## Deploying

Pushing to `main` builds the image for arm64 and amd64, publishes the manifest
to ghcr, then SSHes to the server and runs `sudo once update
marketplace.bigconfig.ai`. There is no approval step: push means deploy.
