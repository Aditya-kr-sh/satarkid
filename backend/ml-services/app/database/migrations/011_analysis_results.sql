ALTER TABLE onboarding_sessions ADD COLUMN IF NOT EXISTS ai_image_result JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE onboarding_sessions ADD COLUMN IF NOT EXISTS face_match_threshold DOUBLE PRECISION;
-- Adopt the requested experimental 50% matching threshold for new comparisons.
INSERT INTO app_settings (key, value, updated_at) VALUES ('face_match_threshold', '0.5', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
