use actix_web::{web, HttpResponse};

use super::AppState;
use crate::error::{AppError, AppResult};
use crate::models::{ClickEvent, LocationCount, ReferrerCount, UrlStats, UserAgentCount};

/// GET /api/stats/{short_code} - Kisa kod istatistigi
pub async fn url_stats(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> AppResult<HttpResponse> {
    let short_code = path.into_inner();

    let url = sqlx::query_as::<_, crate::models::Url>(
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

    // Bugunun takvim gunundeki tiklama (grafikteki son nokta ile ayni metrik)
    let last_24h: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM click_events WHERE url_id = $1 AND clicked_at >= CURRENT_DATE",
    )
    .bind(url.id)
    .fetch_one(&state.db)
    .await?;

    // En cok yonlendiren referrerlar
    let top_referrers: Vec<ReferrerCount> = sqlx::query_as(
        r#"
        SELECT referrer, COUNT(*)::bigint as count
        FROM click_events
        WHERE url_id = $1 AND referrer IS NOT NULL
        GROUP BY referrer
        ORDER BY count DESC
        LIMIT 10
        "#,
    )
    .bind(url.id)
    .fetch_all(&state.db)
    .await?;

    // En sik gorulen user agent (browser)
    let top_user_agents: Vec<UserAgentCount> = sqlx::query_as(
        r#"
        SELECT user_agent, COUNT(*)::bigint as count
        FROM click_events
        WHERE url_id = $1 AND user_agent IS NOT NULL
        GROUP BY user_agent
        ORDER BY count DESC
        LIMIT 5
        "#,
    )
    .bind(url.id)
    .fetch_all(&state.db)
    .await?;

    // En çok gelen lokasyonlar (ülke)
    let top_locations: Vec<LocationCount> = sqlx::query_as(
        r#"
        SELECT COALESCE(NULLIF(country, ''), 'Bilinmiyor') as country, COUNT(*)::bigint as count
        FROM click_events
        WHERE url_id = $1
        GROUP BY COALESCE(NULLIF(country, ''), 'Bilinmiyor')
        ORDER BY count DESC
        LIMIT 5
        "#,
    )
    .bind(url.id)
    .fetch_all(&state.db)
    .await?;

    // Son 50 tiklama
    let recent_clicks: Vec<ClickEvent> = sqlx::query_as(
        r#"
        SELECT id, url_id, host(ip_address)::text as ip_address, user_agent, referrer, country, clicked_at
        FROM click_events
        WHERE url_id = $1
        ORDER BY clicked_at DESC
        LIMIT 50
        "#,
    )
    .bind(url.id)
    .fetch_all(&state.db)
    .await?;

    Ok(HttpResponse::Ok().json(UrlStats {
        short_code: url.short_code,
        long_url: url.long_url,
        click_count: url.click_count,
        created_at: url.created_at,
        last_24h_clicks: last_24h.0,
        top_referrers,
        top_user_agents,
        top_locations,
        recent_clicks,
    }))
}

/// GET /api/stats/{short_code}/timeseries?days=14 - URL bazli gunluk tiklama serisi
#[derive(serde::Deserialize)]
pub struct TimeseriesQuery {
    pub days: Option<i64>,
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct TimeseriesPoint {
    pub day: chrono::DateTime<chrono::Utc>,
    pub clicks: i64,
}

pub async fn url_timeseries(
    state: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<TimeseriesQuery>,
) -> AppResult<HttpResponse> {
    let short_code = path.into_inner();
    let days = query.days.unwrap_or(14).clamp(1, 90);

    let url_id: Option<uuid::Uuid> = sqlx::query_scalar("SELECT id FROM urls WHERE short_code = $1")
        .bind(&short_code)
        .fetch_optional(&state.db)
        .await?;

    let Some(url_id) = url_id else {
        return Err(AppError::NotFound);
    };

    let rows: Vec<TimeseriesPoint> = sqlx::query_as(
        r#"
        SELECT date_trunc('day', clicked_at) as day, COUNT(*)::bigint as clicks
        FROM click_events
        WHERE url_id = $1
          AND clicked_at >= NOW() - ($2 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC
        "#,
    )
    .bind(url_id)
    .bind(days.to_string())
    .fetch_all(&state.db)
    .await?;

    Ok(HttpResponse::Ok().json(rows))
}
