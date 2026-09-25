// ── Suppression de compte à la demande de l'utilisateur ──
// Exigée par Google Play (suppression depuis l'appli) et par la loi 09-08.
//
// Sécurité : l'utilisateur doit envoyer son jeton de session Supabase
// (Authorization: Bearer ...). On vérifie ce jeton côté serveur avant toute
// suppression : personne ne peut supprimer le compte de quelqu'un d'autre.
//
// Ce qui est supprimé : progression, avis sur l'appli, ligne subscribers,
// compte Supabase Auth. Ce qui est conservé : les enregistrements d'achat
// (guide_purchases, Stripe, Paddle), soumis aux obligations comptables.

const { createClient } = require('@supabase/supabase-js');

let supabase = null;
let initError = null;

try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant');
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
} catch (err) {
  initError = err;
  console.error("❌ Erreur d'initialisation de delete-account:", err.message);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://app.waneyo-formation.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const reply = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Méthode non autorisée' });
  if (initError) return reply(500, { error: 'Configuration serveur invalide.' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return reply(401, { error: 'Session manquante. Reconnecte-toi.' });

  // 1. Qui fait la demande ? (jeton vérifié par Supabase)
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return reply(401, { error: 'Session expirée. Reconnecte-toi.' });
  }
  const user = userData.user;
  const email = (user.email || '').toLowerCase();
  // Correspondance exacte (pas de ilike : "_" y serait un joker et pourrait
  // toucher l'email de quelqu'un d'autre). On couvre la casse d'origine + minuscules.
  const emailVariants = [...new Set([user.email, email].filter(Boolean))];

  // 2. Données applicatives (on continue même si une table est absente)
  const cleanups = [
    ['progress', 'user_email'],
    ['app_ratings', 'user_email'],
    ['subscribers', 'email']
  ];
  for (const [table, column] of cleanups) {
    if (!email) break;
    const { error } = await supabase.from(table).delete().in(column, emailVariants);
    if (error) console.warn(`⚠️ delete-account: ${table} non nettoyée (${error.message})`);
  }

  // 3. Compte d'authentification
  const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
  if (delErr) {
    console.error('❌ delete-account: suppression Auth échouée:', delErr.message);
    return reply(500, { error: 'La suppression n\'a pas abouti. Écris à contact@waneyo-formation.com.' });
  }

  console.log(`🗑️ Compte supprimé à la demande de l'utilisateur (id ${user.id})`);
  return reply(200, { ok: true });
};
