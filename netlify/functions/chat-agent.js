// ── Agent IA conversationnel (Gemini) pour l'app ──
// Reçoit un message + un historique court depuis le front-end, appelle
// l'API Gemini côté serveur (clé jamais exposée au navigateur), et renvoie
// la réponse texte. Fonction sans état : c'est le front-end qui renvoie
// l'historique à chaque appel (pas de persistance Supabase pour ce MVP).
//
// Sécurité : la clé GEMINI_API_KEY reste une variable d'environnement
// Netlify, jamais dans le code ni dans les logs. CORS restreint au domaine
// de prod + aux déploiements de prévisualisation Netlify (deploy-preview
// et branch deploys) pour permettre les tests avant mise en ligne.

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROD_ORIGIN = 'https://app.waneyo-formation.com';
// Tout sous-domaine *.netlify.app (deploy previews, branch deploys, et le
// domaine netlify.app par défaut du site) — plus sûr que de deviner le
// nom exact du site, qui peut différer du nom du repo.
const PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.netlify\.app$/;

function corsHeaders(origin) {
  const allowed = origin === PROD_ORIGIN || (origin && PREVIEW_ORIGIN_RE.test(origin))
    ? origin
    : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

const SYSTEM_INSTRUCTION = `Tu es l'assistant intégré à L'Accélérateur Digital (Waneyo Formation), une plateforme
francophone de micro-learning pour entrepreneurs indépendants et porteurs de projet au Maroc,
en France, au Canada et en Afrique francophone.

Ta mission : aider les apprenants à comprendre le contenu des modules, à avancer dans leur
parcours, et surtout donner envie de créer, faire émerger l'ambition de faire mieux et
encourager à se structurer — jamais décourager, jamais culpabiliser.

Règles :
- Réponds toujours en français, sur un ton chaleureux, clair et concret, sans jargon inutile.
- Reste concentré sur : le contenu des modules, le marketing digital, l'entrepreneuriat, la
  structuration d'activité, l'orientation professionnelle proposée par la plateforme.
- Si la question sort de ce cadre (ex. sujet médical, juridique personnel, actualité), dis-le
  simplement et recentre poliment sur ce que tu peux aider à faire ici.
- Ne donne jamais de conseil financier personnalisé ni de recommandation d'investissement.
- Concernant le financement : ne propose que des alternatives conformes à la finance halal
  (mourabaha, tontines, financement participatif islamique) — jamais de crédit à intérêt (riba).
- Si tu ne sais pas ou si la question dépend de données spécifiques au compte de l'apprenant
  (facturation, accès, remboursement), invite à contacter le support plutôt que d'inventer une
  réponse.
- Réponses courtes et actionnables par défaut (quelques phrases) ; développe seulement si la
  question l'exige vraiment.`;

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Méthode non autorisée' };
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY manquant');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration serveur invalide.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const message = (payload.message || '').trim().slice(0, 4000);
  if (!message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Message vide.' }) };
  }

  const rawHistory = Array.isArray(payload.history) ? payload.history : [];
  const history = rawHistory
    .slice(-12)
    .filter((h) => h && typeof h.text === 'string' && h.text.trim())
    .map((h) => ({
      role: h.role === 'assistant' || h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.text.trim().slice(0, 2000) }],
    }));

  const contents = [...history, { role: 'user', parts: [{ text: message }] }];

  try {
    const geminiResponse = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
      }),
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('❌ Erreur API Gemini:', geminiResponse.status, JSON.stringify(data).slice(0, 500));
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "L'assistant est momentanément indisponible, réessaie dans un instant." }),
      };
    }

    const blockReason = data?.promptFeedback?.blockReason;
    const candidate = data?.candidates?.[0];
    const replyText = candidate?.content?.parts?.map((p) => p.text).join('').trim();

    if (blockReason || !replyText) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          reply: "Je ne peux pas répondre à cette question ici. Peux-tu la reformuler, ou contacter le support si besoin ?",
        }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ reply: replyText }) };
  } catch (err) {
    console.error('❌ Exception chat-agent:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "L'assistant est momentanément indisponible, réessaie dans un instant." }),
    };
  }
};
