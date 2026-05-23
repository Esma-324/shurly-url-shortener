pub mod admin;
pub mod qr;
pub mod redirect;
pub mod shorten;
pub mod stats;

use crate::cache::Cache;
use crate::config::Config;
use sqlx::PgPool;

/// Tum handler'lara aktarilan paylasimli durum.
/// Actix-Web her thread/worker icin bunu klonlar (Arc icerir).
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub cache: Cache,
    pub config: Config,
}
