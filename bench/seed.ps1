# ============================================================
# Benchmark icin DB'ye N adet kisa kod yaratir (PowerShell).
# Kullanim:
#   .\bench\seed.ps1 -Count 1000 -Host "http://localhost:8080"
# ============================================================

param(
    [int]$Count = 1000,
    [string]$BackendUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"
$OutFile = "bench\codes.txt"

if (-not (Test-Path bench)) { New-Item -ItemType Directory -Path bench | Out-Null }
"" | Out-File -FilePath $OutFile -Encoding ascii

Write-Host "Hedef : $BackendUrl"
Write-Host "Adet  : $Count"
Write-Host "Output: $OutFile"
Write-Host "----------------------------------------"

$ok = 0
for ($i = 1; $i -le $Count; $i++) {
    $body = @{ url = "https://example.com/seed-$([guid]::NewGuid())-$i" } | ConvertTo-Json -Compress
    try {
        $resp = Invoke-RestMethod -Uri "$BackendUrl/api/shorten" -Method Post `
            -ContentType "application/json" -Body $body -ErrorAction Stop
        Add-Content -Path $OutFile -Value $resp.short_code
        $ok++
    } catch {
        Write-Warning "Eklenemedi (#$i): $($_.Exception.Message)"
    }
    if ($i % 100 -eq 0) { Write-Host "  -> $i / $Count" }
}

Write-Host "----------------------------------------"
Write-Host "Tamam. $ok kod $OutFile icine yazildi."
