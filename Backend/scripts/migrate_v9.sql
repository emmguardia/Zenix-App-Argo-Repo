-- v9 — Propositions d'amélioration : chaque mois, Enzo propose des modifications
-- au client, qui accepte (1 crédit décompté → ticket "À faire") ou refuse.
-- Sans réponse, la proposition reste ouverte et se reporte au mois suivant.

-- Nombre de propositions par mois pour ce client. NULL = crédits de la formule.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS proposals_per_month TINYINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS proposals (
  id              CHAR(36)     NOT NULL,
  organization_id CHAR(36)     NOT NULL,
  batch_id        CHAR(36)     NOT NULL,   -- propositions envoyées ensemble (1 seul email)
  title           VARCHAR(255) NOT NULL,
  description     TEXT         NOT NULL,
  status          ENUM('proposee','acceptee','refusee','retiree') NOT NULL DEFAULT 'proposee',
  ticket_id       CHAR(36)     NULL,       -- ticket créé à l'acceptation
  created_by      CHAR(36)     NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT NOW(3),
  decided_at      DATETIME     NULL,
  decided_by      CHAR(36)     NULL,
  PRIMARY KEY (id),
  KEY idx_proposals_org_status (organization_id, status),
  CONSTRAINT fk_proposals_org    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_proposals_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
