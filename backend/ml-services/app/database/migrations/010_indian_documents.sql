ALTER TABLE onboarding_sessions ADD COLUMN IF NOT EXISTS indian_fields JSONB DEFAULT '{}';
ALTER TABLE onboarding_sessions ADD COLUMN IF NOT EXISTS document_checks JSONB DEFAULT '{}';
