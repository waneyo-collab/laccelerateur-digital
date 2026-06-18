// Renvoie le pays du visiteur détecté par Netlify (à l'edge, depuis son IP réelle).
// Remplace les appels à des services tiers (api.country.is, ipapi.co) qui
// dépendaient du réseau de l'utilisateur et de la CSP du site — point de
// fragilité identifié après un routage Stripe/Paddle incorrect pour un
// client basé au Cameroun.
export default async (request, context) => {
  const country = context.geo?.country?.code || 'FR';
  return Response.json({ country }, {
    headers: { 'Cache-Control': 'no-store' }
  });
};

export const config = { path: '/api/geo' };
