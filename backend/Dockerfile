# ============================================================
#  Stage 1: Builder
# ============================================================
FROM rust:slim-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bagimliliklari onceden cache'le (incremental build)
COPY Cargo.toml ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Asil kaynak ve migrasyonlari kopyala
COPY src ./src
COPY migrations ./migrations

# Binary'i build et (sqlx burada compile-time check icin DB istemiyor cunku
# query! makro yerine sqlx::query / query_as kullaniyoruz)
RUN touch src/main.rs && cargo build --release

# ============================================================
#  Stage 2: Runtime (kucuk imaj)
# ============================================================
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 -s /bin/bash app

WORKDIR /app

COPY --from=builder /app/target/release/url_shortener /usr/local/bin/url_shortener
COPY --from=builder /app/migrations /app/migrations

USER app

ENV RUST_LOG=info,sqlx=warn,actix_web=info \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

CMD ["url_shortener"]
