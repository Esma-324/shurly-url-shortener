-- ====================================================================
-- wrk script: GET /:code (redirect) benchmark
-- ====================================================================
-- Onceden seed.sh ile DB'ye N kisa kod ekleyin, sonra:
--   wrk -t8 -c200 -d30s -s bench/redirect.lua http://localhost:8080
--
-- Bu script bench/codes.txt dosyasindaki her kisa kodu rastgele cagirir.
-- 302 redirect cevabi alindiginda Location header'i takip ETMEZ
-- (yalnizca Rust backend performansini olcuyoruz, hedef sunucuyu degil).
-- ====================================================================

local codes = {}
local file = io.open("bench/codes.txt", "r")
if file then
    for line in file:lines() do
        if line ~= "" then codes[#codes + 1] = line end
    end
    file:close()
end

if #codes == 0 then
    print("HATA: bench/codes.txt bos veya bulunamadi. Once seed.sh calistirin.")
    os.exit(1)
end

math.randomseed(os.time())

request = function()
    local code = codes[math.random(#codes)]
    return wrk.format("GET", "/" .. code, nil, nil)
end

response = function(status, headers, body)
    if status ~= 302 and status ~= 200 then
        print("Beklenmeyen status: " .. status)
    end
end

done = function(summary, latency, requests)
    io.write("\n=== Redirect benchmark ozeti ===\n")
    io.write(string.format("Toplam istek : %d\n", summary.requests))
    io.write(string.format("Sure         : %.2f sn\n", summary.duration / 1e6))
    io.write(string.format("Throughput   : %.2f req/sn\n", summary.requests / (summary.duration / 1e6)))
    io.write(string.format("Latans p50   : %.2f ms\n", latency:percentile(50) / 1000))
    io.write(string.format("Latans p95   : %.2f ms\n", latency:percentile(95) / 1000))
    io.write(string.format("Latans p99   : %.2f ms\n", latency:percentile(99) / 1000))
    io.write(string.format("Latans max   : %.2f ms\n", latency.max / 1000))
end
