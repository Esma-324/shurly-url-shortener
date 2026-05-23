-- URL kaydini olusturan kullanici.
-- Eski kayitlarda NULL kalabilir; bunlar sadece admin gecmisinde gorunur.
ALTER TABLE urls
ADD COLUMN IF NOT EXISTS owner_email VARCHAR(320);

CREATE INDEX IF NOT EXISTS idx_urls_owner_email_created_at
ON urls(owner_email, created_at DESC);
