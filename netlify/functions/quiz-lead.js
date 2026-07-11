// ── Capture des leads du test d'orientation (email-gate) ──
// Enregistre l'email + le profil obtenu dans une table Supabase dédiée
// `quiz_leads`, distincte de `subscribers` (qui gère l'accès payant/partenaire
// et ne doit jamais être touchée par un simple lead marketing).
//
// Sécurité : insertion faite côté serveur avec la clé de service Supabase,
// jamais depuis le navigateur avec la clé anonyme. Un email déjà présent
// n'écrase pas ses données (upsert sans changer created_at, compteur de
// passages incrémenté côté SQL si besoin plus tard).

const { createClient } = require('@supabase/supabase-js');

let supabase = null;
let initError = null;

try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant');
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
} catch (err) {
  initError = err;
  console.error("❌ Erreur d'initialisation de quiz-lead:", err.message);
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
  const profile = (payload.profile || '').trim().slice(0, 120);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Email invalide.' }) };
  }

  try {
    const { error: upsertError } = await supabase.from('quiz_leads').upsert(
      { email, profile, source: 'orientation_quiz' },
      { onConflict: 'email' }
    );
    if (upsertError) {
      console.error('❌ Erreur upsert quiz_leads:', upsertError.message);
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Erreur serveur, réessaie dans un instant.' }) };
    }
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('❌ Exception quiz-lead:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Erreur serveur, réessaie dans un instant.' }) };
  }
};
