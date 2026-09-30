ALTER TABLE crawl_pages ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS crawl_pages_validators_idx ON crawl_pages(source_id, normalized_url, crawled_at DESC);
