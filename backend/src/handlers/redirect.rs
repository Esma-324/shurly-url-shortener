use actix_web::{http::header, web, HttpRequest, HttpResponse};
use uuid::Uuid;

use super::AppState;
use crate::error::{AppError, AppResult};

/// GET /{short_code} - Uzun URL'e yonlendir
///
/// Akis:
/// 1) Once Redis'ten oku (hot path).
/// 2) Yoksa DB'den oku, ardindan cache'e yaz.
/// 3) Tiklamayi async olarak kaydet (kullanici beklemesin).
pub async fn redirect(
    req: HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> AppResult<HttpResponse> {
    let short_code = path.into_inner();

    // 1) Redis cache'i dene
    if let Some(cached) = state.cache.get_url(&short_code).await? {
        log::debug!("Cache HIT: {}", short_code);

        // Cache'te yalniz long_url tutuluyor; suresi dolmus linkleri
        // kacirmamak icin expires_at kontrolunu DB'den yine yap.
        let expires_at: Option<chrono::DateTime<chrono::Utc>> =
            sqlx::query_scalar("SELECT expires_at FROM urls WHERE short_code = $1")
                .bind(&short_code)
                .fetch_optional(&state.db)
                .await?
                .flatten();

        if let Some(exp) = expires_at {
            if exp < chrono::Utc::now() {
                let _ = state.cache.invalidate(&short_code).await;
                return Err(AppError::NotFound);
            }
        }

        spawn_click_logger(&req, &state, short_code.clone(), None);
        return Ok(build_redirect(&cached));
    }

    // 2) DB'den oku
    let url_row = sqlx::query_as::<_, crate::models::Url>(
        r#"
        SELECT id, short_code, long_url, click_count, created_at, expires_at
        FROM urls
        WHERE short_code = $1
        "#,
    )
    .bind(&short_code)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    // Suresi gecmis mi?
    if let Some(exp) = url_row.expires_at {
        if exp < chrono::Utc::now() {
            return Err(AppError::NotFound);
        }
    }

    // 3) Cache'e yaz
    let _ = state
        .cache
        .set_url(&url_row.short_code, &url_row.long_url)
        .await;

    spawn_click_logger(&req, &state, short_code, Some(url_row.id));

    Ok(build_redirect(&url_row.long_url))
}

fn build_redirect(target: &str) -> HttpResponse {
    HttpResponse::Found()
        .insert_header((header::LOCATION, target))
        .insert_header((header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"))
        .finish()
}

/// Tiklamayi arka planda kaydeden gorev (kullanici redirect'i hemen alir).
fn spawn_click_logger(
    req: &HttpRequest,
    state: &web::Data<AppState>,
    short_code: String,
    known_id: Option<Uuid>,
) {
    // Header / IP bilgilerini ana thread'de al, sonra tasi
    let ip = req
        .headers()
        .get("X-Forwarded-For")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| req.peer_addr().map(|a| a.ip().to_string()));

    let user_agent = req
        .headers()
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let referrer = req
        .headers()
        .get(header::REFERER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let country = infer_country(req);

    let state = state.clone();

    tokio::spawn(async move {
        // url_id bilinmiyorsa once cek
        let url_id = match known_id {
            Some(id) => Some(id),
            None => sqlx::query_scalar::<_, Uuid>("SELECT id FROM urls WHERE short_code = $1")
                .bind(&short_code)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten(),
        };

        let Some(url_id) = url_id else { return };

        // Click event INSERT
        let click_res = sqlx::query(
            r#"
            INSERT INTO click_events (url_id, ip_address, user_agent, referrer, country)
            VALUES ($1, $2::inet, $3, $4, $5)
            "#,
        )
        .bind(url_id)
        .bind(ip.as_deref())
        .bind(user_agent.as_deref())
        .bind(referrer.as_deref())
        .bind(country.as_deref())
        .execute(&state.db)
        .await;

        if let Err(e) = click_res {
            log::warn!("Click event kaydedilemedi: {}", e);
        }

        // Toplam click sayacini artir
        let _ = sqlx::query("UPDATE urls SET click_count = click_count + 1 WHERE id = $1")
            .bind(url_id)
            .execute(&state.db)
            .await;

        // Redis'te de sayaci artir
        let _ = state.cache.incr_click(&short_code).await;
    });
}

fn infer_country(req: &HttpRequest) -> Option<String> {
    // Reverse proxy varsa bu header ile dogrudan ulke gelebilir.
    if let Some(country) = req
        .headers()
        .get("CF-IPCountry")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
    {
        return Some(country);
    }

    // Yerel gelistirme ve cogu senaryo icin fallback:
    // Accept-Language'dan bolge kodunu cikart (or. tr-TR -> TR).
    req.headers()
        .get("Accept-Language")
        .and_then(|v| v.to_str().ok())
        .and_then(extract_country_from_accept_language)
}

fn extract_country_from_accept_language(value: &str) -> Option<String> {
    value
        .split(',')
        .map(|item| item.trim().split(';').next().unwrap_or("").trim())
        .filter(|lang| !lang.is_empty())
        .find_map(|lang| {
            let normalized = lang.replace('_', "-");
            let mut parts = normalized.split('-');
            let language = parts.next()?.to_lowercase();

            if let Some(region) = parts.next() {
                if region.len() == 2 && region.chars().all(|c| c.is_ascii_alphabetic()) {
                    return Some(region.to_uppercase());
                }
            }

            // Bazı istemciler "tr" gibi yalın dil kodu yollar.
            // Bu durumda en makul ülke varsayımını kullan.
            match language.as_str() {
                "tr" => Some("TR".to_string()),
                "de" => Some("DE".to_string()),
                "fr" => Some("FR".to_string()),
                "it" => Some("IT".to_string()),
                "es" => Some("ES".to_string()),
                "pt" => Some("PT".to_string()),
                "ru" => Some("RU".to_string()),
                "ja" => Some("JP".to_string()),
                "ko" => Some("KR".to_string()),
                "zh" => Some("CN".to_string()),
                "ar" => Some("SA".to_string()),
                _ => None,
            }
        })
}
