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

// ── Curriculum complet (48 modules / 7 phases) ──
// Source unique de vérité pour que l'agent puisse recommander un module
// précis par son numéro et son titre exact (dashboard ET reader.html).
const PHASES = [
  { name: 'Phase 1 — Le Monde Numérique', from: 1, to: 10 },
  { name: 'Phase 2 — Mindset', from: 11, to: 20 },
  { name: 'Phase 3 — Entreprenariat', from: 21, to: 30 },
  { name: 'Phase 4 — Marketing Psychologique', from: 31, to: 35 },
  { name: 'Phase 5 — Mindset du Dirigeant', from: 36, to: 40 },
  { name: 'Phase 6 — Structuration & Finances', from: 41, to: 45 },
  { name: 'Phase 7 — Niveau Expert', from: 46, to: 48 },
];

const MODULE_TITLES = {
  1: "Introduction au marketing digital", 2: "La stratégie marketing",
  3: "La stratégie multicanale", 4: "La stratégie sur les réseaux sociaux",
  5: "La puissance de l'e-mailing", 6: "Mener des campagnes publicitaires",
  7: "Gérer sa e-réputation", 8: "La cybersécurité",
  9: "La création de contenu", 10: "Méthodologie complète",
  11: "Forger un mental de champion", 12: "Sortir de sa zone de confort",
  13: "Surmonter la peur de l'échec", 14: "Créer une routine de haute performance",
  15: "Garder le cap même quand rien n'avance", 16: "Cultiver la discipline au quotidien",
  17: "Apprendre à apprendre — la méta-compétence clé", 18: "Gérer le syndrome de l'imposteur",
  19: "Développer sa résilience face aux obstacles", 20: "Passer de l'idée à l'action",
  21: "Devenir entrepreneur digital", 22: "Construire son offre et fixer ses prix",
  23: "Créer sa première formation en ligne", 24: "Construire son audience de zéro",
  25: "Vendre sans vendre — le marketing de contenu", 26: "Automatiser son business avec l'IA",
  27: "Gérer sa trésorerie et ses revenus digitaux", 28: "Trouver sa niche — les business accessibles depuis l'Afrique",
  29: "Protéger son business digital", 30: "Ton plan de lancement — passe à l'action maintenant",
  31: "Les leviers d'achat : désir, urgence, appartenance, confiance", 32: "Les freins à l'achat et comment les lever",
  33: "Storytelling & copywriting émotionnel", 34: "Lire son audience : personas, comportements, points de douleur",
  35: "Créer une offre irrésistible sans manipuler",
  36: "Passer de freelance à chef d'entreprise — changer de posture",
  37: "L'art de pitcher : convaincre un partenaire, un incubateur, un client",
  38: "Influence éthique et leadership bienveillant", 39: "Gérer la pression, les doutes et les hauts et bas du business",
  40: "Déléguer sans perdre le contrôle",
  41: "Du statut freelance à la TPE/PME : structure et premiers recrutements",
  42: "Présence en ligne avancée : site pro, SEO, tunnel de vente simple",
  43: "Finance sans crédit : autofinancement, subventions, crowdfunding et financement islamique",
  44: "Préparer son dossier partenaire / incubateur", 45: "Lire ses chiffres : trésorerie, marges et seuil de rentabilité",
  46: "Scaler son business : systèmes, automatisation et délégation avancée",
  47: "Construire sa marque personnelle et son autorité sectorielle",
  48: "De l'entreprise locale à l'impact régional — vision, réseau et héritage",
};

function phaseFor(id) {
  return PHASES.find((p) => id >= p.from && id <= p.to) || null;
}

function buildModuleListText() {
  return PHASES.map((p) => {
    const lines = [];
    for (let id = p.from; id <= p.to; id++) lines.push(`${id}. ${MODULE_TITLES[id]}`);
    return `${p.name} :\n${lines.join('\n')}`;
  }).join('\n\n');
}

function currentModuleContext(moduleId) {
  const id = parseInt(moduleId, 10);
  if (!Number.isInteger(id) || !MODULE_TITLES[id]) return '';
  const phase = phaseFor(id);
  return `\n\nContexte immédiat : l'apprenant est en train de lire le module ${id}, « ${MODULE_TITLES[id]} » (${phase ? phase.name : ''}). Priorise ce contexte si sa question s'y rapporte.`;
}

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
  question l'exige vraiment.
- Quand c'est pertinent, recommande un module précis en citant son numéro et son titre exact
  (voir la liste ci-dessous), plutôt que de rester généraliste.

Voici l'intégralité du programme (48 modules, 7 phases), pour recommander le bon module par
son numéro et son titre exact :

${buildModuleListText()}`;

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
  const systemText = SYSTEM_INSTRUCTION + currentModuleContext(payload.moduleId);

  try {
    const geminiResponse = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { role: 'system', parts: [{ text: systemText }] },
        generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
      }),
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      const bodySnippet = JSON.stringify(data).slice(0, 300);
      console.error('❌ Erreur API Gemini:', geminiResponse.status, bodySnippet);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `[DEBUG TEMPORAIRE] Gemini a renvoyé ${geminiResponse.status} : ${bodySnippet}` }),
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
