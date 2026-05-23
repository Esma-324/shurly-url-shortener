-- URL kisaltma tablosu
CREATE TABLE IF NOT EXISTS urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_code VARCHAR(32) NOT NULL UNIQUE,
    long_url TEXT NOT NULL,
    click_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_urls_short_code ON urls(short_code);
CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);

-- Tiklama olayi (analitik) tablosu
CREATE TABLE IF NOT EXISTS click_events (
    id BIGSERIAL PRIMARY KEY,
    url_id UUID NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    ip_address INET,
    user_agent TEXT,
    referrer TEXT,
    country VARCHAR(8),
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_click_events_url_id ON click_events(url_id);
CREATE INDEX IF NOT EXISTS idx_click_events_clicked_at ON click_events(clicked_at DESC);
