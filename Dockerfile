# syntax=docker/dockerfile:1
# Ubuntu 24.04 is what the upstream mumble-server image runs, and it packages the Ice 3.7 Python bindings
# (python3-zeroc-ice) for its Python 3.12: the same Ice that Murmur links, with nothing to compile.
FROM ubuntu:24.04 AS base
ENV LC_ALL=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    PYTHONHASHSEED=random
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        python3-zeroc-ice \
        tini \
        zeroc-ice-slice \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /bin/uv
ENV UV_NO_CACHE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/venv \
    UV_COMPILE_BYTECODE=1
WORKDIR /src
COPY pyproject.toml uv.lock README.md LICENSE ./
# The venv sees the system site-packages, which is where Ice lives.
RUN uv venv --system-site-packages --python /usr/bin/python3 /venv \
    && uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

# The UI remote that rmui loads from /ui/mumble; mumblermapi serves it from /ui.
# Static files, the same for every platform: built natively, so cross builds never emulate esbuild
FROM --platform=$BUILDPLATFORM node:22.23.3-bookworm-slim AS ui
WORKDIR /ui
COPY ui/package.json ui/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY ui ./
# index.html is the development harness; rmui loads remoteEntry.js
RUN pnpm build && rm dist/index.html

FROM base AS production
COPY --from=build /venv /venv
COPY --from=ui /ui/dist /ui
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--", "/venv/bin/murmur-agent"]
