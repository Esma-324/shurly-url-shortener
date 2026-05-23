use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::StatusCode,
    Error, HttpResponse,
};
use dashmap::DashMap;
use futures_util::future::LocalBoxFuture;
use std::collections::VecDeque;
use std::future::{ready, Ready};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Sliding-window IP bazli rate limiter.
///
/// Her IP icin son `window` icindeki istek timestamp'lerini tutar;
/// pencere disindaki kayitlari periyodik olarak temizler.
/// Bu yapi `dashmap` sayesinde lock-free okuma/yazma saglar.
pub struct RateLimiter {
    inner: Arc<RateLimiterInner>,
}

struct RateLimiterInner {
    buckets: DashMap<String, VecDeque<Instant>>,
    max_requests: u32,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max_requests_per_minute: u32) -> Self {
        let inner = Arc::new(RateLimiterInner {
            buckets: DashMap::new(),
            max_requests: max_requests_per_minute,
            window: Duration::from_secs(60),
        });

        // Arka planda eski kayitlari temizle (memory leak koruma)
        let cleanup_inner = inner.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(120));
            loop {
                interval.tick().await;
                let now = Instant::now();
                cleanup_inner.buckets.retain(|_, q| {
                    while let Some(&front) = q.front() {
                        if now.duration_since(front) > cleanup_inner.window {
                            q.pop_front();
                        } else {
                            break;
                        }
                    }
                    !q.is_empty()
                });
            }
        });

        Self { inner }
    }

    fn check(&self, ip: &str) -> bool {
        let now = Instant::now();
        let mut bucket = self.inner.buckets.entry(ip.to_string()).or_default();

        // Pencere disindakileri at
        while let Some(&front) = bucket.front() {
            if now.duration_since(front) > self.inner.window {
                bucket.pop_front();
            } else {
                break;
            }
        }

        if bucket.len() as u32 >= self.inner.max_requests {
            false
        } else {
            bucket.push_back(now);
            true
        }
    }
}

impl Clone for RateLimiter {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

// ===== Actix-Web Middleware ozellestirmesi =====

impl<S, B> Transform<S, ServiceRequest> for RateLimiter
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type InitError = ();
    type Transform = RateLimiterMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(RateLimiterMiddleware {
            service,
            limiter: self.clone(),
        }))
    }
}

pub struct RateLimiterMiddleware<S> {
    service: S,
    limiter: RateLimiter,
}

impl<S, B> Service<ServiceRequest> for RateLimiterMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        // Istemci IP'sini al (proxy arkasinda X-Forwarded-For destekli)
        let ip = req
            .headers()
            .get("X-Forwarded-For")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next())
            .map(|s| s.trim().to_string())
            .or_else(|| {
                req.headers()
                    .get("X-Real-IP")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
            })
            .or_else(|| req.peer_addr().map(|a| a.ip().to_string()))
            .unwrap_or_else(|| "unknown".to_string());

        if !self.limiter.check(&ip) {
            log::warn!("Rate limit asildi: IP={}", ip);
            let resp = HttpResponse::build(StatusCode::TOO_MANY_REQUESTS)
                .insert_header(("Retry-After", "60"))
                .json(serde_json::json!({
                    "error": "rate_limited",
                    "message": "Cok fazla istek gonderdiniz. Lutfen 60 saniye bekleyin."
                }));
            let (request, _) = req.into_parts();
            return Box::pin(async move {
                Ok(ServiceResponse::new(request, resp).map_into_right_body())
            });
        }

        let fut = self.service.call(req);
        Box::pin(async move {
            let res = fut.await?;
            Ok(res.map_into_left_body())
        })
    }
}
