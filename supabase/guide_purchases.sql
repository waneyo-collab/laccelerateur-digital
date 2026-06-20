-- Table de suivi des ventes du Guide Marketing (Stripe + Paddle)
-- À exécuter dans Supabase → SQL Editor

create table if not exists guide_purchases (
  id bigint generated always as identity primary key,
  email text not null,
  psp text not null,              -- 'stripe' ou 'paddle'
  amount numeric(10,2),           -- montant payé
  created_at timestamptz not null default now()
);

-- Sécurité : aucun accès public, seul le service role (utilisé par les
-- webhooks) peut lire/écrire. Même logique que tes autres tables.
alter table guide_purchases enable row level security;

create policy "service role full access"
  on guide_purchases
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
