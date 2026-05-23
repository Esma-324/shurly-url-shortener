use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;

/// PostgreSQL baglanti havuzu olusturur ve migrationlari calistirir.
///
/// Rust'in async/await sistemi sayesinde bu fonksiyon engelleyici degildir;
/// Tokio runtime uzerinde diger gorevler paralel ilerleyebilir.
pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(600))
        .connect(database_url)
        .await?;

    log::info!("PostgreSQL baglantisi kuruldu");

    // Migrasyonlari calistir
    sqlx::migrate!("./migrations").run(&pool).await?;
    log::info!("Migrasyonlar uygulandi");

    Ok(pool)
}
