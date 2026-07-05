/**
 * Module de scoring — Questionnaire d'orientation professionnelle
 * Base scientifique : RIASEC (Holland) + Big Five (modérateur)
 *
 * Usage :
 *   const result = computeProfile(answers);
 *   // answers = { q1: "a", q2: "c", ... }
 */

const RIASEC_DIMENSIONS = ["R", "I", "A", "S", "E", "C"];
const BIGFIVE_DIMENSIONS = ["extraversion", "conscience", "ouverture", "agreabilite", "stabilite"];

// Mapping combinaison RIASEC dominante (2 lettres, ordre non signifiant) -> profil
const PROFILE_MAP = {
  "E,S": "Commercial(e) / Vente",
  "E,A": "Marketeur / Growth",
  "S,A": "Community Manager",
  "C,E": "Gestion de projet",
  "I,A": "Créateur(trice) de contenu / Stratégie de marque",
  "I,C": "Analyste / Data",
  "R,E": "Entrepreneur(e) généraliste",
  "S,C": "Formateur(trice) / Coordination pédagogique",
  "R,I": "Expert(e) technique / Résolution de problèmes concrets",
  "R,A": "Artisan(e)-créateur(rice) / Maker",
  "R,S": "Formateur(trice) terrain / Accompagnement pratique",
  "R,C": "Opérations / Logistique-Qualité",
  "I,S": "Consultant(e) / Expert(e)-conseil",
  "I,E": "Stratège / Analyste business",
  "A,C": "Designer / Production créative structurée"
};

/**
 * Calcule les scores bruts RIASEC et Big Five à partir des réponses.
 * @param {Object} answers - { questionId: optionId }
 * @param {Object} quiz - le questionnaire JSON chargé
 * @returns {Object} { riasec: {...}, bigfive: {...} }
 */
function computeRawScores(answers, quiz) {
  const riasec = Object.fromEntries(RIASEC_DIMENSIONS.map(d => [d, 0]));
  const bigfive = Object.fromEntries(BIGFIVE_DIMENSIONS.map(d => [d, 0]));

  for (const question of quiz.questions) {
    const chosenId = answers[question.id];
    if (!chosenId) continue; // question non répondue, ignorée
    const option = question.options.find(o => o.id === chosenId);
    if (!option) continue; // réponse invalide, ignorée silencieusement

    for (const [dim, value] of Object.entries(option.scores)) {
      if (dim in riasec) riasec[dim] += value;
      else if (dim in bigfive) bigfive[dim] += value;
    }
  }

  return { riasec, bigfive };
}

/**
 * Détermine les 2 dimensions RIASEC dominantes.
 */
function getTopTwoDimensions(riasecScores) {
  const sorted = Object.entries(riasecScores).sort((a, b) => b[1] - a[1]);
  return [sorted[0][0], sorted[1][0]];
}

/**
 * Trouve le profil correspondant à une paire de dimensions, dans les deux ordres possibles.
 */
function resolveProfile(dimA, dimB) {
  return PROFILE_MAP[`${dimA},${dimB}`] || PROFILE_MAP[`${dimB},${dimA}`] || "Profil hybride — à affiner";
}

/**
 * Ajoute un sous-profil basé sur les traits Big Five dominants (modérateur).
 * Règle simple et transparente : si extraversion nette négative et profil "terrain/réseau",
 * on suggère une variante plus stratégique/analytique. Sinon, pas de sous-profil.
 */
function getSubProfile(mainProfile, bigfive) {
  const isIntrovert = bigfive.extraversion < 0;
  const isHighlyRigorous = bigfive.conscience > 0;

  if (mainProfile === "Marketeur / Growth" && isIntrovert) {
    return "Marketeur stratégique / analytique (plutôt que terrain)";
  }
  if (mainProfile === "Commercial(e) / Vente" && isIntrovert) {
    return "Commercial(e) en approche consultative (plutôt que prospection intensive)";
  }
  if (mainProfile === "Gestion de projet" && isHighlyRigorous) {
    return "Gestion de projet — profil PMO / cadrage rigoureux";
  }
  return null;
}

/**
 * Fonction principale : calcule le profil complet à partir des réponses.
 */
function computeProfile(answers, quiz) {
  const { riasec, bigfive } = computeRawScores(answers, quiz);
  const [dimA, dimB] = getTopTwoDimensions(riasec);
  const mainProfile = resolveProfile(dimA, dimB);
  const subProfile = getSubProfile(mainProfile, bigfive);

  return {
    riasecScores: riasec,
    bigfiveScores: bigfive,
    dominantDimensions: [dimA, dimB],
    profile: mainProfile,
    subProfile: subProfile
  };
}

module.exports = { computeProfile, computeRawScores, getTopTwoDimensions, resolveProfile };
