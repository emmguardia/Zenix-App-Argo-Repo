-- v6 — Signature électronique en ligne (eIDAS simple) + email de facturation

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS requires_signature TINYINT(1) NOT NULL DEFAULT 0 AFTER type,
  ADD COLUMN IF NOT EXISTS signed_at       DATETIME     NULL AFTER requires_signature,
  ADD COLUMN IF NOT EXISTS signed_by       CHAR(36)     NULL AFTER signed_at,
  ADD COLUMN IF NOT EXISTS signature_name  VARCHAR(100) NULL AFTER signed_by,
  ADD COLUMN IF NOT EXISTS signature_hash  CHAR(64)     NULL AFTER signature_name,
  ADD COLUMN IF NOT EXISTS signature_ip    VARCHAR(45)  NULL AFTER signature_hash,
  ADD COLUMN IF NOT EXISTS signed_r2_key   VARCHAR(500) NULL AFTER signature_ip;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255) NULL AFTER billing_address;
