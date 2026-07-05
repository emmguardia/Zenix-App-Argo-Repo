-- v3 — Engagement annuel (12e mois offert) + tarif spécial par client (ex. grille Asso)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_interval ENUM('monthly','annual') NOT NULL DEFAULT 'monthly' AFTER plan,
  ADD COLUMN IF NOT EXISTS custom_price_id  VARCHAR(255) NULL AFTER billing_interval;
