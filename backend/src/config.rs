use std::env;

/// Uygulama yapilandirmasi (env'den yuklenir)
#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub redis_url: String,
    /// false ise Redis'e hic baglanilmaz (onbellek kapali).
    pub redis_enabled: bool,
    /// true ise Redis baglanti hatasinda uyari ile devre disi onbellege dusulur.
    pub redis_optional: bool,
    pub base_url: String,
    pub rate_limit_per_minute: u32,
    pub short_code_length: usize,
    pub cache_ttl_seconds: u64,
}

fn env_flag_false(name: &str) -> bool {
    env::var(name)
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            )
        })
        .unwrap_or(false)
}

fn env_flag_true(name: &str, default: bool) -> bool {
    env::var(name)
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

impl Config {
    /// Ortam degiskenlerinden konfigurasyonu okur.
    /// Gerekli alanlar eksikse uygulama panic eder (fail-fast).
    pub fn from_env() -> Self {
        // .env dosyasi varsa yukle (yoksa hata vermez)
        let _ = dotenvy::dotenv();

        Self {
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080),
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL env degiskeni tanimli olmali"),
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
            redis_enabled: !env_flag_false("REDIS_ENABLED"),
            redis_optional: env_flag_true("REDIS_OPTIONAL", false),
            base_url: env::var("BASE_URL")
                .unwrap_or_else(|_| "http://localhost:8080".to_string()),
            rate_limit_per_minute: env::var("RATE_LIMIT_PER_MINUTE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
            short_code_length: env::var("SHORT_CODE_LENGTH")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(7),
            cache_ttl_seconds: env::var("CACHE_TTL_SECONDS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(3600),
        }
    }
}
