-- v4 — Tarif asso/entreprise + nouveau cycle des tickets reportés

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS pricing_tier ENUM('standard','asso') NOT NULL DEFAULT 'standard' AFTER plan;

-- a_confirmer : ticket reporté revenu chez le client en début de mois (il re-valide ou annule)
ALTER TABLE tickets
  MODIFY COLUMN status ENUM('en_attente','valide','refuse','reporte','a_confirmer','annule','termine') NOT NULL DEFAULT 'en_attente';
