#!/usr/bin/env bash
# ============================================================
# Tum benchmark senaryolarini sirayla calistirir.
# Sartlar:
#   - wrk kurulu olmali  (https://github.com/wg/wrk)
#   - backend ayakta olmali (varsayilan: http://localhost:8080)
#   - bench/codes.txt seed.sh ile uretilmis olmali
#   - Bench oncesi RATE_LIMIT_PER_MINUTE'i yuksek tutun
# ============================================================

set -euo pipefail

HOST="${1:-http://localhost:8080}"
DURATION="${DURATION:-30s}"
THREADS="${THREADS:-8}"
CONNS="${CONNS:-200}"

if ! command -v wrk >/dev/null 2>&1; then
    echo "HATA: wrk bulunamadi. Onerilen: https://github.com/wg/wrk"
    exit 1
fi

echo "============================================"
echo " Shurly Benchmark Suite"
echo " Host    : $HOST"
echo " Duration: $DURATION"
echo " Threads : $THREADS"
echo " Conns   : $CONNS"
echo "============================================"

echo
echo "## 1) Health endpoint (baseline)"
wrk -t"$THREADS" -c"$CONNS" -d"$DURATION" "$HOST/health"

echo
echo "## 2) Redirect endpoint (cache-heavy)"
wrk -t"$THREADS" -c"$CONNS" -d"$DURATION" -s bench/redirect.lua "$HOST"

echo
echo "## 3) Shorten endpoint (DB write)"
wrk -t4 -c50 -d"$DURATION" -s bench/shorten.lua "$HOST"

echo
echo "Tamam."
