-- v8 — Factures déposées manuellement (création de site, anciens hébergements...)
-- Elles apparaissent dans "Mes factures" du client, mélangées aux factures Stripe.

ALTER TABLE documents
  MODIFY COLUMN type ENUM('contrat','contrat_signe','cgv','devis','facture','zip_offboarding','autre') NOT NULL;
