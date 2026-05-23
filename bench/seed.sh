#!/usr/bin/env bash
# ============================================================
# Benchmark icin DB'ye N adet kisa kod yaratir.
# Kullanim: ./bench/seed.sh [adet] [host]
#   ./bench/seed.sh 1000 http://localhost:8080
# ============================================================

set -euo pipefail

COUNT="${1:-1000}"
HOST="${2:-http://localhost:8080}"

# Rate limit ile catismamak icin /api/shorten yerine kucuk bir gecikme veya
# yuksek bir limit kullanin (DB'ye dogrudan psql ile insert de yapilabilir).

OUT_FILE="bench/codes.txt"
mkdir -p bench
: > "$OUT_FILE"

echo "Hedef: $HOST"
echo "Adet : $COUNT"
echo "Output: $OUT_FILE"
echo "----------------------------------------"

for i in $(seq 1 "$COUNT"); do
    URL="https://example.com/seed-${RANDOM}-${i}?bench=1"
    RESP=$(curl -s -X POST "$HOST/api/shorten" \
        -H "Content-Type: application/json" \
        -d "{\"url\":\"$URL\"}")

    CODE=$(echo "$RESP" | sed -n 's/.*"short_code":"\([^"]*\)".*/\1/p')
    if [[ -z "$CODE" ]]; then
        echo "Uyari: kayit eklenemedi -> $RESP"
    else
        echo "$CODE" >> "$OUT_FILE"
    fi

    if (( i % 100 == 0 )); then
        echo "  -> $i / $COUNT"
    fi
done

echo "----------------------------------------"
echo "Tamam. $(wc -l < "$OUT_FILE") kod $OUT_FILE icine yazildi."
