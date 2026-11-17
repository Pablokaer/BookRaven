-- "Upload and share" goes out on its own one day after sign-up to accounts that haven't uploaded
-- a book (apps/api/src/lib/automations.ts). Administrators can still turn it off or change the days.
INSERT INTO email_automation (id, enabled, days) VALUES ('onboarding', true, 1)
ON CONFLICT (id) DO UPDATE SET enabled = true, days = 1, updated_at = now();
