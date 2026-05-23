// =====================================================================
//  URL Shortener - Rust + Actix-Web + Tokio + sqlx + Redis
//  ----------------------------------------------------------
//  - Ownership/borrow checker ile bellek guvenli
//  - Tokio runtime uzerinde tamamen async (zero-cost abstraction)
//  - Trait-based polymorphism (Service, ResponseError, FromRow ...)
//  - `Result<T, E>` ve `?` operatoru ile temiz hata akisi
// =====================================================================

mod cache;
mod config;
mod db;
mod error;
mod handlers;
mod middleware;
mod models;

use actix_cors::Cors;
use actix_web::{middleware as actix_mw, web, App, HttpResponse, HttpServer};

use crate::cache::Cache;
use crate::config::Config;
use crate::handlers::{admin, qr, redirect, shorten, stats, AppState};
use crate::middleware::rate_limit::RateLimiter;

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "url-shortener",
        "engine": "actix-web + tokio"
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Logger'i baslat (RUST_LOG env'i ile seviye ayarlanabilir)
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let config = Config::from_env();
    log::info!(
        "Sunucu basliyor: {}:{} (base_url={})",
        config.host,
        config.port,
        config.base_url
    );

    // PostgreSQL ve Redis baglantisi (paralel acmiyoruz cunku migrations DB gerektirir)
    let db = db::init_pool(&config.database_url)
        .await
        .expect("PostgreSQL baglantisi kurulamadi");

    let cache = if !config.redis_enabled {
        Cache::disabled(config.cache_ttl_seconds)
    } else {
        match Cache::connect(&config.redis_url, config.cache_ttl_seconds).await {
            Ok(c) => c,
            Err(e) if config.redis_optional => {
                log::warn!("Redis baglantisi kurulamadi, onbellek devre disi: {}", e);
                Cache::disabled(config.cache_ttl_seconds)
            }
            Err(e) => panic!("Redis baglantisi kurulamadi: {}", e),
        }
    };

    let state = AppState {
        db,
        cache,
        config: config.clone(),
    };

    let limiter = RateLimiter::new(config.rate_limit_per_minute);
    let bind_addr = (config.host.clone(), config.port);

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .app_data(web::Data::new(state.clone()))
            .app_data(web::JsonConfig::default().limit(64 * 1024))
            .wrap(actix_mw::Logger::new("%a \"%r\" %s %T"))
            .wrap(actix_mw::Compress::default())
            .wrap(cors)
            // API endpointleri rate-limit middleware'i ile sarilmis
            .service(
                web::scope("/api")
                    .wrap(limiter.clone())
                    .route("/shorten", web::post().to(shorten::shorten_url))
                    .route("/url/{code}", web::put().to(shorten::rename_url))
                    .route("/url/{code}", web::delete().to(shorten::delete_url))
                    .route("/stats/{code}", web::get().to(stats::url_stats))
                    .route("/stats/{code}/timeseries", web::get().to(stats::url_timeseries))
                    .route("/qr/{code}", web::get().to(qr::generate_qr))
                    .route("/admin/overview", web::get().to(admin::overview))
                    .route("/admin/timeseries", web::get().to(admin::timeseries)),
            )
            .route("/health", web::get().to(health))
            // Kisa kod redirect (en sona, catch-all gibi)
            .route("/{code}", web::get().to(redirect::redirect))
    })
    .bind(bind_addr)?
    .run()
    .await
}
