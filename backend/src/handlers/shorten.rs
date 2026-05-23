use actix_web::{web, HttpResponse};
use chrono::Duration;
use nanoid::nanoid;
use url::Url as ParsedUrl;

use super::AppState;
use crate::error::{AppError, AppResult};
use crate::models::{RenameUrlRequest, ShortenRequest, ShortenResponse};

/// nanoid icin URL-friendly alfabe (karistirilabilir karakterler hariç)
const ALPHABET: [char; 58] = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'm', 'n', 'p', 'q', 'r', 's', 't', 'u',
    'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P',
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '2', '3', '4', '5', '6', '7', '8', '9', '_',
    '-',
];

/// URL formatini ve seman in dogrulugunu kontrol eder.
fn validate_url(url: &str) -> AppResult<()> {
    let parsed = ParsedUrl::parse(url).map_err(|_| AppError::InvalidUrl(url.to_string()))?;

    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(AppError::InvalidUrl(format!(
            "Sadece http/https desteklenir, '{}' verildi",
            scheme
        )));
    }

    if parsed.host().is_none() {
        return Err(AppError::InvalidUrl("URL host icermiyor".to_string()));
    }

    Ok(())
}

/// Custom kodu validate eder (alfasayisal + tire/altcizgi, 3-32 karakter).
fn validate_custom_code(code: &str) -> AppResult<()> {
    if code.len() < 3 || code.len() > 32 {
        return Err(AppError::InvalidUrl(
            "Custom kod 3-32 karakter olmali".to_string(),
        ));
    }
    if !code
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::InvalidUrl(
            "Custom kod yalniz harf, rakam, '-' ve '_' icerebilir".to_string(),
        ));
    }
    // Sistem yollari ile catismayi engelle
    let reserved = ["api", "admin", "stats", "health", "static"];
    if reserved.contains(&code.to_lowercase().as_str()) {
        return Err(AppError::Conflict);
    }
    Ok(())
}

fn normalize_custom_code(input: &str) -> String {
    let mut out = String::with_capacity(input.len());

    for ch in input.trim().chars() {
        let mapped = match ch {
            // Turkce karakterleri ASCII karsiligina cevir
            'ç' | 'Ç' => Some('c'),
            'ğ' | 'Ğ' => Some('g'),
            'ı' | 'İ' | 'I' => Some('i'),
            'ö' | 'Ö' => Some('o'),
            'ş' | 'Ş' => Some('s'),
            'ü' | 'Ü' => Some('u'),
            // Bosluk ve yaygin ayiricilar -> tire
            ' ' | '.' | ',' | '/' | '\\' => Some('-'),
            _ => None,
        };

        if let Some(c) = mapped {
            out.push(c);
            continue;
        }

        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        }
    }

    // Birden cok tireyi teke indir, basi/sonu temizle
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_dash = false;
    for c in out.chars() {
        if c == '-' {
            if !prev_dash {
                collapsed.push(c);
            }
            prev_dash = true;
        } else {
            collapsed.push(c);
            prev_dash = false;
        }
    }

    collapsed.trim_matches('-').to_string()
}

/// POST /api/shorten - URL kisalt
pub async fn shorten_url(
    state: web::Data<AppState>,
    payload: web::Json<ShortenRequest>,
) -> AppResult<HttpResponse> {
    validate_url(&payload.url)?;

    let cfg = &state.config;

    // Kisa kod uret veya custom kullan (cakisma kontrolu ile)
    let short_code = if let Some(custom) = &payload.custom_code {
        let code = normalize_custom_code(custom);
        validate_custom_code(&code)?;

        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM urls WHERE short_code = $1)")
                .bind(&code)
                .fetch_one(&state.db)
                .await?;
        if exists {
            return Err(AppError::Conflict);
        }
        code
    } else {
        // Cakisma durumunda yeniden dene (en fazla 5 kez)
        let mut attempts = 0;
        loop {
            let size = cfg.short_code_length;
            let candidate = nanoid!(size, &ALPHABET);
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM urls WHERE short_code = $1)",
            )
            .bind(&candidate)
            .fetch_one(&state.db)
            .await?;
            if !exists {
                break candidate;
            }
            attempts += 1;
            if attempts > 5 {
                return Err(AppError::Internal(
                    "Kisa kod uretilemedi, lutfen tekrar deneyin".to_string(),
                ));
            }
        }
    };

    let expires_at = payload
        .expires_in_days
        .map(|d| chrono::Utc::now() + Duration::days(d));
    let owner_email = payload.owner_email.as_ref().map(|email| email.trim().to_lowercase());

    let row = sqlx::query_as::<_, crate::models::Url>(
        r#"
        INSERT INTO urls (short_code, long_url, expires_at, owner_email)
        VALUES ($1, $2, $3, $4)
        RETURNING id, short_code, long_url, click_count, created_at, expires_at
        "#,
    )
    .bind(&short_code)
    .bind(&payload.url)
    .bind(expires_at)
    .bind(owner_email)
    .fetch_one(&state.db)
    .await?;

    // Yeni URL'i hemen cache'e koy (sonraki redirect cabuk olsun)
    let _ = state
        .cache
        .set_url(&row.short_code, &row.long_url)
        .await;

    let short_url = format!("{}/{}", cfg.base_url.trim_end_matches('/'), row.short_code);

    log::info!("URL kisaltildi: {} -> {}", row.short_code, row.long_url);

    Ok(HttpResponse::Created().json(ShortenResponse {
        short_code: row.short_code,
        short_url,
        long_url: row.long_url,
        created_at: row.created_at,
        expires_at: row.expires_at,
    }))
}

/// PUT /api/url/{code} - Kisa kodu yeniden adlandir
pub async fn rename_url(
    state: web::Data<AppState>,
    path: web::Path<String>,
    payload: web::Json<RenameUrlRequest>,
) -> AppResult<HttpResponse> {
    let old_code = path.into_inner();
    let new_code = normalize_custom_code(&payload.new_code);
    validate_custom_code(&new_code)?;

    let cfg = &state.config;
    if old_code == new_code {
        let short_url = format!(
            "{}/{}",
            cfg.base_url.trim_end_matches('/'),
            old_code
        );
        return Ok(HttpResponse::Ok().json(serde_json::json!({
            "short_code": old_code,
            "short_url": short_url
        })));
    }

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM urls WHERE short_code = $1)")
        .bind(&new_code)
        .fetch_one(&state.db)
        .await?;
    if exists {
        return Err(AppError::Conflict);
    }

    let updated = sqlx::query(
        "UPDATE urls SET short_code = $1 WHERE short_code = $2"
    )
    .bind(&new_code)
    .bind(&old_code)
    .execute(&state.db)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    let _ = state.cache.invalidate(&old_code).await;

    let short_url = format!(
        "{}/{}",
        cfg.base_url.trim_end_matches('/'),
        new_code
    );

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "short_code": new_code,
        "short_url": short_url
    })))
}

/// DELETE /api/url/{code} - Kisa URL'i sil
pub async fn delete_url(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> AppResult<HttpResponse> {
    let code = path.into_inner();
    let deleted = sqlx::query("DELETE FROM urls WHERE short_code = $1")
        .bind(&code)
        .execute(&state.db)
        .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    let _ = state.cache.invalidate(&code).await;

    Ok(HttpResponse::NoContent().finish())
}
