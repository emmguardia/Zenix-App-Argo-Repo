-- v2 — Onboarding client autonome (infos -> offre -> validation -> contrat -> paiement)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS contact_first_name VARCHAR(100) NULL AFTER name,
  ADD COLUMN IF NOT EXISTS contact_last_name  VARCHAR(100) NULL AFTER contact_first_name,
  ADD COLUMN IF NOT EXISTS contact_phone      VARCHAR(30)  NULL AFTER contact_last_name,
  ADD COLUMN IF NOT EXISTS onboarding_status  ENUM('infos','plan','review','contract','payment','done') NOT NULL DEFAULT 'infos' AFTER status,
  ADD COLUMN IF NOT EXISTS validated_at       DATETIME NULL AFTER onboarding_status;

-- Contrat signé re-déposé par le client (les deux versions sont conservées)
ALTER TABLE documents
  MODIFY COLUMN type ENUM('contrat','contrat_signe','cgv','devis','zip_offboarding','autre') NOT NULL;

-- Les organisations existantes (créées avant v2) sont considérées comme complètes
UPDATE organizations SET onboarding_status = 'done' WHERE status = 'active';
