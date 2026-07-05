-- Zenix App — Schéma espace client
-- Base : zenix_app (créée par root, cf. prérequis)

-- Identité (liée à Authentik) : authentik_sub NULL tant que le client ne
-- s'est jamais connecté (fiche pré-créée par l'admin, match par email)
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL,
  authentik_sub VARCHAR(255) NULL,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL DEFAULT '',
  created_at    DATETIME(3)  NOT NULL DEFAULT NOW(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_sub (authentik_sub),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Entité facturée : tout l'argent / crédits / tickets vivent ICI, jamais sur users
CREATE TABLE IF NOT EXISTS organizations (
  id                     CHAR(36)     NOT NULL,
  name                   VARCHAR(255) NOT NULL,
  legal_type             ENUM('entreprise','association','particulier') NOT NULL,
  siret                  VARCHAR(14)  NULL,
  vat_number             VARCHAR(20)  NULL,
  billing_address        TEXT         NULL,
  stripe_customer_id     VARCHAR(255) NULL,
  stripe_subscription_id VARCHAR(255) NULL,
  plan                   ENUM('start','relax','pro') NULL,
  status                 ENUM('pending','active','past_due','canceled') NOT NULL DEFAULT 'pending',
  linked_domain          VARCHAR(255) NULL,
  cgv_accepted_at        DATETIME     NULL,
  created_at             DATETIME(3)  NOT NULL DEFAULT NOW(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_stripe_customer (stripe_customer_id),
  KEY idx_org_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Liaison user ↔ organisation, gérée À LA MAIN par l'admin
-- (1 personne peut avoir plusieurs orgas : asso + entreprise, 1 seul login)
CREATE TABLE IF NOT EXISTS memberships (
  user_id         CHAR(36) NOT NULL,
  organization_id CHAR(36) NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (user_id, organization_id),
  KEY idx_memberships_org (organization_id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_memberships_org  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ledger de crédits : des LOTS qui expirent, jamais de reset.
-- Consommation par expires_at ASC → forfait avant pack, gratuitement.
-- stripe_invoice_id UNIQUE = idempotence des webhooks invoice.paid rejoués.
CREATE TABLE IF NOT EXISTS credit_grants (
  id                CHAR(36)    NOT NULL,
  organization_id   CHAR(36)    NOT NULL,
  source            ENUM('forfait','pack','geste_commercial') NOT NULL,
  quantity          SMALLINT UNSIGNED NOT NULL,
  used              SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  granted_at        DATETIME(3) NOT NULL DEFAULT NOW(3),
  expires_at        DATETIME    NOT NULL,
  stripe_invoice_id VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grants_invoice (stripe_invoice_id),
  KEY idx_grants_consume (organization_id, expires_at),
  CONSTRAINT fk_grants_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tickets de modification.
-- Cycle : en_attente → valide → termine | refuse (recrédit lot d'origine)
--         reporte = hors crédit, consommera le lot du mois suivant (FIFO)
CREATE TABLE IF NOT EXISTS tickets (
  id              CHAR(36)     NOT NULL,
  organization_id CHAR(36)     NOT NULL,
  created_by      CHAR(36)     NULL,
  credit_grant_id CHAR(36)     NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT         NOT NULL,
  status          ENUM('en_attente','valide','refuse','reporte','termine') NOT NULL DEFAULT 'en_attente',
  created_at      DATETIME(3)  NOT NULL DEFAULT NOW(3),
  decided_at      DATETIME     NULL,
  completed_at    DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_tickets_org_status (organization_id, status),
  KEY idx_tickets_status (status, created_at),
  CONSTRAINT fk_tickets_org   FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_user  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_grant FOREIGN KEY (credit_grant_id) REFERENCES credit_grants (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pièces jointes des tickets (fichiers dans R2, jamais d'URL publique)
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id         INT          NOT NULL AUTO_INCREMENT,
  ticket_id  CHAR(36)     NOT NULL,
  r2_key     VARCHAR(500) NOT NULL,
  filename   VARCHAR(255) NOT NULL,
  size       INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_attachments_ticket (ticket_id),
  CONSTRAINT fk_attachments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Documents (contrats signés, devis…) — métadonnées, fichiers dans R2
CREATE TABLE IF NOT EXISTS documents (
  id              CHAR(36)     NOT NULL,
  organization_id CHAR(36)     NOT NULL,
  type            ENUM('contrat','devis','zip_offboarding','autre') NOT NULL,
  r2_key          VARCHAR(500) NOT NULL,
  filename        VARCHAR(255) NOT NULL,
  uploaded_by     CHAR(36)     NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_documents_org (organization_id),
  CONSTRAINT fk_documents_org  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_user FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Journal d'audit — qui a fait quoi, quand (anti-litige)
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  actor_type ENUM('client','admin','system') NOT NULL,
  actor_id   CHAR(36)     NULL,
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(50)  NOT NULL,
  entity_id  VARCHAR(64)  NOT NULL,
  details    JSON         NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity, entity_id),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
