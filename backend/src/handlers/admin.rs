use actix_web::{web, HttpResponse};

use super::AppState;
use crate::error::AppResult;
use crate::models::{AdminOverview, TopUrl, Url};

/// GET /api/admin/overview - Admin istatistik paneli icin ozet
pub async fn overview(state: web::Data<AppState>) -> AppResult<HttpResponse> {
    let total_urls: (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM urls")
        .fetch_one(&state.db)
        .await?;

    let total_clicks: (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM click_events")
        .fetch_one(&state.db)
        .await?;

    let clicks_24h: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM click_events WHERE clicked_at >= CURRENT_DATE",
    )
    .fetch_one(&state.db)
    .await?;

    let clicks_7d: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM click_events WHERE clicked_at > NOW() - INTERVAL '7 days'",
    )
    .fetch_one(&state.db)
    .await?;

    let top_urls: Vec<TopUrl> = sqlx::query_as(
        r#"
        SELECT
            u.short_code,
            u.long_url,
            COUNT(c.id)::bigint AS click_count,
            u.created_at
        FROM urls u
        JOIN click_events c ON c.url_id = u.id
        GROUP BY u.id, u.short_code, u.long_url, u.created_at
        ORDER BY COUNT(c.id) DESC, MAX(c.clicked_at) DESC, u.created_at DESC, u.short_code ASC
        LIMIT 10
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let recent_urls: Vec<Url> = sqlx::query_as(
        r#"
        SELECT id, short_code, long_url, click_count, created_at, expires_at
        FROM urls
        ORDER BY created_at DESC
        LIMIT 20
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(HttpResponse::Ok().json(AdminOverview {
        total_urls: total_urls.0,
        total_clicks: total_clicks.0,
        clicks_last_24h: clicks_24h.0,
        clicks_last_7d: clicks_7d.0,
        top_urls,
        recent_urls,
    }))
}

/// GET /api/admin/timeseries?days=7 - Gunluk tiklama serisi (chart icin)
#[derive(serde::Deserialize)]
pub struct TimeseriesQuery {
    pub days: Option<i64>,
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct TimeseriesPoint {
    pub day: chrono::DateTime<chrono::Utc>,
    pub clicks: i64,
}

pub async fn timeseries(
    state: web::Data<AppState>,
    query: web::Query<TimeseriesQuery>,
) -> AppResult<HttpResponse> {
    let days = query.days.unwrap_or(7).clamp(1, 90);

    let rows: Vec<TimeseriesPoint> = sqlx::query_as(
        r#"
        SELECT date_trunc('day', clicked_at) as day, COUNT(*)::bigint as clicks
        FROM click_events
        WHERE clicked_at > NOW() - ($1 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC
        "#,
    )
    .bind(days.to_string())
    .fetch_all(&state.db)
    .await?;

    Ok(HttpResponse::Ok().json(rows))
}
