// ── Inscription gratuite via partenariat institutionnel (ANAPEC, ANETI...) ──
// Crée un compte Supabase Auth + une ligne subscribers avec partenaire_code
// rempli → accès gratuit limité au Niveau Débutant (phases 1-3), restriction
// gérée côté front dans index.html (variable _partnerLimited).
//
// Sécurité : seuls les codes listés dans ALLOWED_PARTNER_CODES sont acceptés,
// pour éviter qu'un visiteur invente un code au hasard dans l'URL. Si l'email
// correspond déjà à un abonné payant (stripe_customer_id ou paddle_customer_id
// renseigné), on ne touche pas à son compte : on ne veut jamais qu'un abonné
// payant se retrouve restreint par erreur.

const { createClient } = require('@supabase/supabase-js');
const { generateSetupLink, sendWelcomeEmail, ensureAccount } = require('./_account-setup');

const ALLOWED_PARTNER_CODES = ['ANAPEC', 'ANETI'];

let supabase = null;
let initError = null;

try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant');
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
} catch (err) {
  initError = err;
  console.error("❌ Erreur d'initialisation de partner-signup:", err.message);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://app.waneyo-formation.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Méthode non autorisée' };
  }
  if (initError) {
    return { statusCode: 500, headers: CORS_HEADERS, body: `Configuration serveur invalide: ${initError.message}` };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: 'JSON invalide' };
  }

  const email = (payload.email || '').trim().toLowerCase();
  const firstName = (payload.first_name || '').trim();
  const code = (payload.partner_code || '').trim().toUpperCase();

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Email invalide.' }) };
  }
  if (!ALLOWED_PARTNER_CODES.includes(code)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Code partenaire inconnu.' }) };
  }

  try {
    // 1. Compte déjà existant (payant ou non) ?
    const { data: existing, error: selectError } = await supabase
      .from('subscribers')
      .select('email, status, stripe_customer_id, paddle_customer_id, partenaire_code')
      .eq('email', email)
      .maybeSingle();
    if (selectError) console.error('❌ Erreur select subscribers (partner-signup):', selectError.message);

    if (existing) {
      const isPayingCustomer = !!(existing.stripe_customer_id || existing.paddle_customer_id);
      if (isPayingCustomer) {
        // On ne restreint jamais un abonné payant : on le renvoie simplement
        // se connecter avec son compte existant.
        return {
          statusCode: 200, headers: CORS_HEADERS,
          body: JSON.stringify({ ok: true, alreadyExists: true, isPayingCustomer: true })
        };
      }
      if (existing.status === 'active') {
        // Déjà un compte partenaire actif → on ne renvoie pas de nouvel email,
        // juste une confirmation pour que le front affiche le bon message.
        return {
          statusCode: 200, headers: CORS_HEADERS,
          body: JSON.stringify({ ok: true, alreadyExists: true, isPayingCustomer: false })
        };
      }
    }

    // 2. Création du compte Supabase Auth (idempotent : ensureAccount gère déjà le cas existant)
    const isNewUser = await ensureAccount(supabase, email, { first_name: firstName, partenaire_code: code });

    // 3. Ligne subscribers : statut actif, code partenaire renseigné
    const { error: upsertError } = await supabase.from('subscribers').upsert(
      { email, status: 'active', first_name: firstName, partenaire_code: code },
      { onConflict: 'email' }
    );
    if (upsertError) {
      console.error('❌ Erreur upsert subscribers (partner-signup):', upsertError.message);
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Erreur serveur, réessaie dans un instant.' }) };
    }

    // 4. Email de bienvenue avec lien de création de mot de passe
    const setupLink = await generateSetupLink(supabase, email, isNewUser);
    if (setupLink) await sendWelcomeEmail(email, firstName, setupLink);

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, alreadyExists: false }) };
  } catch (err) {
    console.error('❌ Exception partner-signup:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Erreur serveur, réessaie dans un instant.' }) };
  }
};
