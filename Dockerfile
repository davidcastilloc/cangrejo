# ==============================================================================
# 🦀 CANGREJO — Multi-Stage Polyglot Production Dockerfile (Rust cdylib + Bun)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Compile Native Rust Barnes-Hut Quadtree & Rayon Engine (cdylib)
# ------------------------------------------------------------------------------
FROM rust:1.85-slim-bookworm AS rust-builder
WORKDIR /build/packages/layout-rs
COPY packages/layout-rs/Cargo.toml ./Cargo.toml
COPY packages/layout-rs/src ./src
RUN cargo build --release

# ------------------------------------------------------------------------------
# Stage 2: Install Dependencies & Build Frontend Assets with Bun
# ------------------------------------------------------------------------------
FROM oven/bun:1.4.3-debian AS bun-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
COPY index.html vite.config.ts tsconfig.json ./
COPY --from=rust-builder /build/packages/layout-rs/target/release/libcangrejo_layout_rs.so ./packages/layout-rs/target/release/libcangrejo_layout_rs.so

RUN bun install --frozen-lockfile && bun run build

# ------------------------------------------------------------------------------
# Stage 3: Minimal Production Runtime (Bun.serve + SQLite WAL + Native FFI)
# ------------------------------------------------------------------------------
FROM oven/bun:1.4.3-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV CANGREJO_HOST=0.0.0.0
ENV CANGREJO_PORT=3000
ENV CANGREJO_SQLITE_PATH=/data/cangrejo_vault.sqlite

RUN mkdir -p /data && chown -R bun:bun /data

COPY --from=bun-builder /app/package.json /app/bun.lock ./
COPY --from=bun-builder /app/node_modules ./node_modules
COPY --from=bun-builder /app/packages ./packages
COPY --from=bun-builder /app/apps ./apps
COPY --from=bun-builder /app/dist ./dist

VOLUME ["/data"]
EXPOSE 3000

USER bun
CMD ["bun", "run", "apps/web/bunServer.ts"]
