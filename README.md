# L'Accélérateur Digital

**Plateforme SaaS de micro-learning francophone pour entrepreneurs — par [Waneyo Formation](https://www.waneyo-formation.com)**

🔗 App en ligne : [app.waneyo-formation.com](https://app.waneyo-formation.com)
🔗 Tunnel de vente : [www.waneyo-formation.com](https://www.waneyo-formation.com)

---

## À propos

L'Accélérateur Digital transforme l'envie d'entreprendre en compétences concrètes de marketing digital, à travers un parcours structuré de 48 modules (débutant → intermédiaire → expert). L'objectif n'est pas seulement de transmettre des outils, mais de faire naître l'ambition : donner à chacun l'envie de créer, de viser plus haut, et de structurer un vrai projet plutôt qu'une idée.

**Public cible :** entrepreneurs et porteurs de projet francophones au Maroc, en France, au Canada et en Afrique francophone.

**Positionnement produit :**
- **Kit de démarrage** (39 €, achat unique) — 8 modules autonomes, vendus sur le tunnel Systeme.io
- **Application complète** (accès à vie, 59 € en B2C) — les 48 modules, sur `app.waneyo-formation.com`
- **Cohortes B2B / incubateurs** — tarification dégressive par volume (45 € / 39 € / 29 € / 25 € par apprenant), accès via code partenaire

Le contenu est **natif** (rédigé par Waneyo Formation), avec des personnages fictifs africains et maghrébins variés selon les villes, et une contrainte de zéro riba : seules des alternatives conformes (mourabaha, tontines, financement participatif islamique) sont proposées lorsqu'un module aborde le financement.

---

## Fonctionnalités

- **Parcours de 48 modules JSON** répartis en 3 phases (Débutant, Intermédiaire, Expert), avec sections, quiz et progression suivie
- **Lecteur natif** (`reader.html`) : rendu markdown, quiz interactif, lecture audio via Web Speech API (TTS)
- **Quiz d'orientation professionnelle** (RIASEC + Big Five, 45 questions, 15 profils) pour qualifier les leads avant l'achat
- **Certificat de fin de parcours** généré automatiquement (PDF, via jsPDF) à 30 modules complétés
- **Espace partenaires institutionnels** : accès par code (`?partenaire=ANAPEC`, `ANETI`…), tableau de bord directeur (`director.html`) filtré par incubateur
- **PWA installable** : mode hors-ligne partiel via Service Worker, manifeste avec icônes et thème de marque
- **Paiement géo-adapté** : Stripe (Europe/Amériques) ou Paddle (Afrique), routé automatiquement par géolocalisation
- **Pages légales complètes** : mentions légales, politique de confidentialité (loi 09-08 / CNDP Maroc), CGV (loi 31-08)

---

## Stack technique

| Brique | Choix |
|---|---|
| Frontend | SPA/PWA en HTML/CSS/JS **sans framework** (fetch direct vers Supabase, pas de SDK côté client sauf `@supabase/supabase-js` pour l'auth) |
| Hébergement & fonctions | [Netlify](https://netlify.com) (site statique + Netlify Functions + Edge Functions) |
| Base de données & auth | [Supabase](https://supabase.com) (région EU/Irlande), avec Row Level Security |
| Paiement | Stripe (Europe/Amériques) + Paddle (Afrique), géo-routage via Edge Function |
| Email transactionnel | [Resend](https://resend.com) (SMTP dédié) |

> Choix assumé : rester sur une PWA web plutôt qu'une app native (store), le coût et la complexité n'étant pas justifiés au stade actuel (traction B2B via incubateurs).

---

## Structure du repo

```
├── index.html              # Application principale (SPA)
├── reader.html              # Lecteur de module (contenu, quiz, TTS)
├── admin.html                # Back-office administrateur
├── director.html            # Dashboard directeur d'incubateur (filtré par code partenaire)
├── orientation.html          # Quiz d'orientation professionnelle (lead magnet)
├── confirm.html               # Étape de confirmation humaine avant activation de compte
├── modules/                   # 48 modules de contenu (module-01.json … module-48.json)
├── ressources/                 # PDF téléchargeables (guides, e-books, check-lists)
├── netlify/
│   ├── functions/              # Fonctions serverless (paiement, leads, onboarding)
│   └── edge-functions/          # Géo-routage Stripe/Paddle
├── supabase/                    # Scripts SQL (achats, codes partenaires)
├── manifest.json, sw.js, icon-*.png   # Configuration PWA
├── mentions-legales.html, confidentialite.html, cgv.html  # Pages légales
└── netlify.toml                 # Configuration de build/déploiement
```

---

## Variables d'environnement (Netlify)

À configurer dans **Site settings → Environment variables** :

| Variable | Usage |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_KEY` | Clé service (côté serveur uniquement) |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | Vérification des webhooks Stripe |
| `PADDLE_API_KEY` | Clé API Paddle |
| `PADDLE_WEBHOOK_SECRET` | Vérification des webhooks Paddle |
| `GUIDE_STRIPE_PAYMENT_LINK_ID` | Lien de paiement Stripe pour le guide marketing (5,99 €) |
| `GUIDE_PADDLE_PRICE_ID` | ID de prix Paddle pour le même produit |
| `RESEND_API_KEY` | Envoi des emails transactionnels |

⚠️ Ne jamais commiter ces valeurs dans le code — elles doivent rester exclusivement dans les variables d'environnement Netlify.

---

## Déploiement

Le site est déployé automatiquement sur **Netlify** à chaque push sur la branche principale (`publish = "."`, `functions = "netlify/functions"`). Aucune étape de build n'est nécessaire : les fichiers HTML/JS sont servis tels quels.

Un service **UptimeRobot** ping l'application toutes les 5 minutes pour éviter la mise en pause automatique du projet Supabase (plan gratuit).

---

## Conformité légale

- 🇲🇦 Maroc : conformité à la loi 09-08 (protection des données), déclarations CNDP F211 (gestion des comptes + capture de leads)
- 🇫🇷 France : CGV excluant le droit de rétractation pour les contenus numériques consommés immédiatement (loi 31-08)
- Bannière de consentement cookies affichée uniquement en présence de traceurs non essentiels (Meta Pixel, Google Analytics)

---

## Roadmap

- [ ] Narrateur audio enrichi pour l'ensemble des modules
- [ ] Tableau de bord admin pour transmettre automatiquement les données d'apprentissage aux incubateurs partenaires

---

## Licence

Projet propriétaire — © Waneyo Formation. Tous droits réservés. Ce dépôt n'est pas open source ; il est privé et réservé au développement de l'application.
