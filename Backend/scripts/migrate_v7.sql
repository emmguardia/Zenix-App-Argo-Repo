-- v7 — Messagerie client <-> admin (1 conversation par organisation)

CREATE TABLE IF NOT EXISTS messages (
  id              CHAR(36)    NOT NULL,
  organization_id CHAR(36)    NOT NULL,
  sender          ENUM('client','admin') NOT NULL,
  sender_id       CHAR(36)    NULL,
  body            TEXT        NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_messages_org (organization_id, created_at),
  CONSTRAINT fk_messages_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Accusés de lecture : côté admin uniquement (le client ne voit rien — RGPD ok,
-- intérêt légitime, à mentionner dans la politique de confidentialité)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS client_last_read_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS admin_last_read_at  DATETIME NULL;
