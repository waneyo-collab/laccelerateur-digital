-- Ajout de la colonne partenaire_code sur subscribers
-- À exécuter dans Supabase → SQL Editor
--
-- Permet de marquer un compte comme issu d'un partenariat institutionnel
-- (ANAPEC, ANETI...) : accès gratuit limité au Niveau Débutant (phases 1-3),
-- géré côté front dans index.html (variable _partnerLimited).

alter table subscribers
  add column if not exists partenaire_code text;

-- Index utile si on veut un jour sortir des statistiques par partenaire
create index if not exists subscribers_partenaire_code_idx
  on subscribers (partenaire_code);
