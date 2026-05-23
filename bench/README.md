# Benchmark — wrk ile yük testi

Bu klasörde Rust + Actix-Web URL kısaltıcının performansını ölçmek için `wrk` script'leri var.

## Kurulum

`wrk` kurulu olmalı: <https://github.com/wg/wrk>

- Linux : `sudo apt install wrk` ya da `brew install wrk`
- macOS : `brew install wrk`
- Windows : WSL2 üzerinden `wrk` çalıştırmak en pratiği. Native bir alternatif: `bombardier`, `oha`, `vegeta` (komutlar farklıdır, scriptleri uyarlamanız gerekir).

## Hazırlık

1) Backend'i benchmark moduna alın — IP rate limit'i çok yüksek tutun, aksi halde wrk istekleri 429 yer:

```bash
# docker-compose.yml icindeki backend servisinde:
RATE_LIMIT_PER_MINUTE: 1000000
```

`docker compose up --build -d` ile yeniden başlatın.

2) DB'ye N adet kısa kod ekleyin (redirect benchmark için kaynaklar gerekli):

```bash
# Linux/macOS
chmod +x bench/seed.sh
./bench/seed.sh 2000 http://localhost:8080

# Windows PowerShell
.\bench\seed.ps1 -Count 2000 -BackendUrl http://localhost:8080
```

Bu komut `bench/codes.txt` üretir.

## Senaryolar

### 1) Health endpoint (baseline)

Sadece JSON döndürür, DB/Redis erişimi yoktur. Saf framework throughput'u.

```bash
wrk -t8 -c200 -d30s http://localhost:8080/health
```

### 2) Redirect (cache-heavy)

Sıcak URL Redis'ten okunur, DB'ye yalnızca cache miss veya tıklama loglarında erişilir.

```bash
wrk -t8 -c200 -d30s -s bench/redirect.lua http://localhost:8080
```

### 3) Shorten (DB write)

Her istek DB'ye INSERT yapar; en pahalı senaryo.

```bash
wrk -t4 -c50 -d30s -s bench/shorten.lua http://localhost:8080
```

### Hepsini bir arada

```bash
chmod +x bench/run.sh
./bench/run.sh http://localhost:8080
```

## Tipik Sonuçlar (referans)

> Geliştirici makinesinde Docker üzerinden alınan örnek değerlerdir; production donanımda anlamlı olarak iyileşir.

| Senaryo   | Throughput   | p50      | p95      | p99      |
|-----------|--------------|----------|----------|----------|
| /health   | ~80k req/s   | ~0.4 ms  | ~1.0 ms  | ~2.0 ms  |
| Redirect  | ~25k req/s   | ~2.0 ms  | ~5.0 ms  | ~9.0 ms  |
| Shorten   | ~6k req/s    | ~7.0 ms  | ~16 ms   | ~30 ms   |

## İpuçları

- `wrk` `--latency` bayrağı detaylı dağılım verir.
- Connection sayısını çok artırırsanız PostgreSQL pool (`max_connections=20`) darboğaz olur. `db.rs` içinde `max_connections` değerini yükseltin.
- Click loglarını `tokio::spawn` ile arka plana atıyoruz; bu sayede redirect cevabı log INSERT'i beklemeden döner.
- Daha gerçekçi ölçüm için Docker `--cpus` ve `--memory` limitleri kaldırın, ya da production benzeri donanım kullanın.
