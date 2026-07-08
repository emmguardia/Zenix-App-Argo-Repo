-- v5 — Offre "Essentiel" (asso uniquement) : hébergement seul, 0 modification incluse

ALTER TABLE organizations
  MODIFY COLUMN plan ENUM('essentiel','start','relax','pro') NULL;
