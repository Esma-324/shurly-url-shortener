use actix_web::{web, HttpResponse};
use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};
use serde::Deserialize;

use super::AppState;
use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
pub struct QrQuery {
    /// Onerilen kenar uzunlugu (px). 64-1024 araliginda clamp edilir.
    pub size: Option<u32>,
    /// "svg" (default) veya ileride "png" gibi formatlar eklenebilir.
    pub format: Option<String>,
    /// Koyu renk (hex), ornek: "0d0f1a"
    pub dark: Option<String>,
    /// Acik renk (hex), ornek: "ffffff"
    pub light: Option<String>,
}

fn normalize_hex(s: &str) -> String {
    let s = s.trim().trim_start_matches('#');
    if s.len() == 6 || s.len() == 3 {
        format!("#{}", s)
    } else {
        // Gecersiz - varsayilana don
        String::from("#0d0f1a")
    }
}

/// GET /api/qr/{code} - kisa kod icin QR kodu (SVG)
///
/// Akis:
/// 1) Kisa kodun varligini DB'den dogrula (var olmayan koda QR uretmiyoruz).
/// 2) `BASE_URL/<code>` icin QR kodu olustur (M seviyesinde hata duzeltme).
/// 3) Vector (SVG) olarak don; yuksek DPI'de kalite kaybi yok, dosya kucuk.
pub async fn generate_qr(
    state: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<QrQuery>,
) -> AppResult<HttpResponse> {
    let short_code = path.into_inner();

    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM urls WHERE short_code = $1)")
            .bind(&short_code)
            .fetch_one(&state.db)
            .await?;
    if !exists {
        return Err(AppError::NotFound);
    }

    let target = format!(
        "{}/{}",
        state.config.base_url.trim_end_matches('/'),
        short_code
    );

    // Medium hata duzeltme: yaklasik %15 hasara karsi okunabilirlik
    let code = QrCode::with_error_correction_level(target.as_bytes(), EcLevel::M)
        .map_err(|e| AppError::Internal(format!("QR olusturulamadi: {}", e)))?;

    let size = query.size.unwrap_or(320).clamp(64, 1024);

    let dark = query
        .dark
        .as_deref()
        .map(normalize_hex)
        .unwrap_or_else(|| "#0d0f1a".to_string());
    let light = query
        .light
        .as_deref()
        .map(normalize_hex)
        .unwrap_or_else(|| "#ffffff".to_string());

    let svg_data: String = code
        .render()
        .min_dimensions(size, size)
        .dark_color(svg::Color(dark.as_str()))
        .light_color(svg::Color(light.as_str()))
        .quiet_zone(true)
        .build();

    let format = query.format.as_deref().unwrap_or("svg");
    if format != "svg" {
        return Err(AppError::InvalidUrl(
            "Sadece 'svg' formati destekleniyor".to_string(),
        ));
    }

    Ok(HttpResponse::Ok()
        .content_type("image/svg+xml; charset=utf-8")
        .insert_header(("Cache-Control", "public, max-age=3600"))
        .insert_header((
            "Content-Disposition",
            format!("inline; filename=\"qr-{}.svg\"", short_code),
        ))
        .body(svg_data))
}
