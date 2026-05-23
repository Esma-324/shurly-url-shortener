use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Veritabaninda saklanan URL kaydi
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Url {
    pub id: Uuid,
    pub short_code: String,
    pub long_url: String,
    pub click_count: i64,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Tiklama olayi kaydi (analitik)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ClickEvent {
    pub id: i64,
    pub url_id: Uuid,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub referrer: Option<String>,
    pub country: Option<String>,
    pub clicked_at: DateTime<Utc>,
}

// ===== Request / Response DTO'lari =====

#[derive(Debug, Deserialize)]
pub struct ShortenRequest {
    pub url: String,
    pub custom_code: Option<String>,
    pub expires_in_days: Option<i64>,
    pub owner_email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RenameUrlRequest {
    pub new_code: String,
}

#[derive(Debug, Serialize)]
pub struct ShortenResponse {
    pub short_code: String,
    pub short_url: String,
    pub long_url: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct UrlStats {
    pub short_code: String,
    pub long_url: String,
    pub click_count: i64,
    pub created_at: DateTime<Utc>,
    pub last_24h_clicks: i64,
    pub top_referrers: Vec<ReferrerCount>,
    pub top_user_agents: Vec<UserAgentCount>,
    pub top_locations: Vec<LocationCount>,
    pub recent_clicks: Vec<ClickEvent>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ReferrerCount {
    pub referrer: Option<String>,
    pub count: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct UserAgentCount {
    pub user_agent: Option<String>,
    pub count: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct LocationCount {
    pub country: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminOverview {
    pub total_urls: i64,
    pub total_clicks: i64,
    pub clicks_last_24h: i64,
    pub clicks_last_7d: i64,
    pub top_urls: Vec<TopUrl>,
    pub recent_urls: Vec<Url>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct TopUrl {
    pub short_code: String,
    pub long_url: String,
    pub click_count: i64,
    pub created_at: DateTime<Utc>,
}
