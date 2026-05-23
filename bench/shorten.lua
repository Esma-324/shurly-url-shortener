-- ====================================================================
-- wrk script: POST /api/shorten benchmark
-- ====================================================================
-- Calistirma:
--   wrk -t4 -c50 -d30s -s bench/shorten.lua http://localhost:8080
--
-- DIKKAT: Eger backend'in rate limit'i devrede ise (varsayilan 60/dk/IP)
-- localhost'tan gelen istekler 429 yiyebilir. Bench oncesi
-- RATE_LIMIT_PER_MINUTE=1000000 (veya benzeri yuksek bir deger) ile
-- backend'i tekrar baslatin.
-- ====================================================================

wrk.method = "POST"
wrk.headers["Content-Type"] = "application/json"

local counter = 0
math.randomseed(os.time())
local rand_id = math.random(1, 1e9)

request = function()
    counter = counter + 1
    local body = string.format(
        '{"url":"https://example.com/path-%d-%d?ref=wrk"}',
        rand_id, counter
    )
    return wrk.format("POST", "/api/shorten", { ["Content-Type"] = "application/json" }, body)
end

local ok = 0
local errors = 0

response = function(status, headers, body)
    if status == 201 then
        ok = ok + 1
    else
        errors = errors + 1
    end
end

done = function(summary, latency, requests)
    io.write("\n=== Shorten benchmark ozeti ===\n")
    io.write(string.format("Toplam istek : %d\n", summary.requests))
    io.write(string.format("Basarili     : %d\n", ok))
    io.write(string.format("Hatali       : %d\n", errors))
    io.write(string.format("Sure         : %.2f sn\n", summary.duration / 1e6))
    io.write(string.format("Throughput   : %.2f req/sn\n", summary.requests / (summary.duration / 1e6)))
    io.write(string.format("Latans p50   : %.2f ms\n", latency:percentile(50) / 1000))
    io.write(string.format("Latans p95   : %.2f ms\n", latency:percentile(95) / 1000))
    io.write(string.format("Latans p99   : %.2f ms\n", latency:percentile(99) / 1000))
end
