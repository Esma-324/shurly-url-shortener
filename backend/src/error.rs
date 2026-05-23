use actix_web::{http::StatusCode, HttpResponse, ResponseError};
use serde::Serialize;
use thiserror::Error;

/// Uygulama geneli hata tipi.
/// Rust'in `Result<T, E>` ve `?` operatoru ile birlikte kullanilir.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Veritabani hatasi: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Redis hatasi: {0}")]
    Redis(#[from] redis::RedisError),

    #[error("Gecersiz URL: {0}")]
    InvalidUrl(String),

    #[error("Kisa kod bulunamadi")]
    NotFound,

    #[error("Bu isim zaten kullanılıyor.")]
    Conflict,

    #[error("Bu URL daha once kisaltilmis")]
    DuplicateUrl,

    #[error("Cok fazla istek - rate limit asildi")]
    RateLimited,

    #[error("Ic sunucu hatasi: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    message: String,
}

impl ResponseError for AppError {
    fn status_code(&self) -> StatusCode {
        match self {
            AppError::InvalidUrl(_) => StatusCode::BAD_REQUEST,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Conflict => StatusCode::CONFLICT,
            AppError::DuplicateUrl => StatusCode::CONFLICT,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> HttpResponse {
        let code = self.status_code();
        let error = match self {
            AppError::InvalidUrl(_) => "invalid_url",
            AppError::NotFound => "not_found",
            AppError::Conflict => "conflict",
            AppError::DuplicateUrl => "duplicate_url",
            AppError::RateLimited => "rate_limited",
            AppError::Database(_) => "database_error",
            AppError::Redis(_) => "cache_error",
            AppError::Internal(_) => "internal_error",
        };

        HttpResponse::build(code).json(ErrorResponse {
            error: error.to_string(),
            message: self.to_string(),
        })
    }
}

pub type AppResult<T> = Result<T, AppError>;
