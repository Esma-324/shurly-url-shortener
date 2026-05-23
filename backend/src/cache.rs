use crate::error::AppResult;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;

/// Redis baglanti yoneticisi (asenkron, otomatik reconnect destekli).
/// `conn` yoksa tum islemler no-op (yerel gelistirme icin Redis olmadan calisma).
#[derive(Clone)]
pub struct Cache {
    conn: Option<ConnectionManager>,
    ttl_seconds: u64,
}

impl Cache {
    pub fn disabled(ttl_seconds: u64) -> Self {
        log::warn!("Redis kullanilmiyor; URL onbellegi ve Redis tiklama sayaci devre disi");
        Self {
            conn: None,
            ttl_seconds,
        }
    }

    pub async fn connect(redis_url: &str, ttl_seconds: u64) -> AppResult<Self> {
        let client = redis::Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await?;
        log::info!("Redis baglantisi kuruldu (TTL: {}s)", ttl_seconds);
        Ok(Self {
            conn: Some(conn),
            ttl_seconds,
        })
    }

    fn key(short_code: &str) -> String {
        format!("url:{}", short_code)
    }

    /// Hot URL'i cache'e yaz (TTL ile).
    pub async fn set_url(&self, short_code: &str, long_url: &str) -> AppResult<()> {
        let Some(mut conn) = self.conn.clone() else {
            return Ok(());
        };
        let _: () = conn
            .set_ex(Self::key(short_code), long_url, self.ttl_seconds)
            .await?;
        Ok(())
    }

    /// Cache'den URL oku (yoksa None).
    pub async fn get_url(&self, short_code: &str) -> AppResult<Option<String>> {
        let Some(mut conn) = self.conn.clone() else {
            return Ok(None);
        };
        let val: Option<String> = conn.get(Self::key(short_code)).await?;
        Ok(val)
    }

    /// Cache invalidasyon (URL silinince/guncellenince).
    pub async fn invalidate(&self, short_code: &str) -> AppResult<()> {
        let Some(mut conn) = self.conn.clone() else {
            return Ok(());
        };
        let _: () = conn.del(Self::key(short_code)).await?;
        Ok(())
    }

    /// Tiklama sayacini Redis'te artir (atomic INCR).
    /// Bu sayede sicak URL'lerde DB'ye her tiklamada yazma yapmiyoruz;
    /// asenkron flusher bunu DB'ye periyodik olarak ozel olarak yazabilir.
    pub async fn incr_click(&self, short_code: &str) -> AppResult<i64> {
        let Some(mut conn) = self.conn.clone() else {
            return Ok(0);
        };
        let key = format!("clicks:{}", short_code);
        let count: i64 = conn.incr(key, 1).await?;
        Ok(count)
    }
}
