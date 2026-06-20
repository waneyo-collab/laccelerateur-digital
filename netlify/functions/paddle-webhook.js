const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendGuideEmail, logGuidePurchase } = require('./_guide-delivery');

// ── Initialisation défensive (même pattern que stripe-webhook.js) ──────────
let supabase = null;
let initError = null;

try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant');
  }
  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    throw new Error('PADDLE_WEBHOOK_SECRET manquant');
  }
  if (!process.env.PADDLE_API_KEY) {
    throw new Error('PADDLE_API_KEY manquant');
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
} catch (err) {
  initError = err;
  console.error('❌ Erreur d\'initialisation du webhook Paddle:', err.message);
}

// Vérifie la signature Paddle (header "Paddle-Signature": ts=...;h1=...)
// Doc officielle : https://developer.paddle.com/webhooks/about/signature-verification
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const match = signatureHeader.match(/^ts=(\d+);h1=([a-f0-9]+)$/);
  if (!match) return false;
  const [, ts, h1] = match;

  // Anti-replay : on rejette les webhooks trop vieux (> 5 minutes)
  const age = Math.abs(Date.now() / 1000 - parseInt(ts, 10));
  if (age > 300) {
    console.error('❌ Webhook Paddle trop ancien (anti-replay)');
    return false;
  }

  const signedPayload = `${ts}:${rawBody}`;
  const computed = crypto
    .createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  // Comparaison en temps constant
  const a = Buffer.from(computed);
  const b = Buffer.from(h1);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// L'email n'est pas toujours présent dans le payload transaction.* : on le
// récupère via l'API Paddle à partir du customer_id si besoin.
async function getCustomerEmail(transaction) {
  if (transaction.customer?.email) return transaction.customer.email;
  if (!transaction.customer_id) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.paddle.com/customers/${transaction.customer_id}`, {
      headers: { 'Authorization': `Bearer ${process.env.PADDLE_API_KEY}` },
      signal: controller.signal
    });
    if (!res.ok) {
      console.error('❌ Erreur récupération customer Paddle:', res.status, await res.text());
      return null;
    }
    const json = await res.json();
    return json.data?.email || null;
  } catch (err) {
    console.error('❌ Exception getCustomerEmail:', err.name, err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async (event) => {
  if (initError) {
    console.error('❌ Webhook Paddle appelé avec une config invalide:', initError.message);
    return { statusCode: 500, body: `Configuration serveur invalide: ${initError.message}` };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const signatureHeader = event.headers['paddle-signature'] || event.headers['Paddle-Signature'];
  if (!verifySignature(rawBody, signatureHeader)) {
    console.error('❌ Signature Paddle invalide');
    return { statusCode: 400, body: 'Signature invalide' };
  }

  let paddleEvent;
  try {
    paddleEvent = JSON.parse(rawBody);
  } catch (err) {
    console.error('❌ JSON invalide:', err.message);
    return { statusCode: 400, body: 'JSON invalide' };
  }

  // Tout le traitement métier est protégé : une erreur ne doit jamais
  // provoquer un 500 (Paddle réessaierait indéfiniment).
  try {
    if (paddleEvent.event_type === 'transaction.completed') {
      const transaction = paddleEvent.data;
      const priceId = transaction.items?.[0]?.price?.id || transaction.items?.[0]?.price_id;

      if (priceId === process.env.GUIDE_PADDLE_PRICE_ID) {
        const email = await getCustomerEmail(transaction);
        if (email) {
          const sent = await sendGuideEmail(supabase, email, '');
          if (!sent) console.error(`❌ Email guide NON envoyé pour ${email}`);
          const amount = transaction.details?.totals?.total
            ? Number(transaction.details.totals.total) / 100
            : 0;
          await logGuidePurchase(supabase, { email, psp: 'paddle', amount });
        } else {
          console.error('❌ Impossible de récupérer l\'email du client Paddle pour la transaction', transaction.id);
        }
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Erreur inattendue webhook Paddle:', err.message, err.stack);
    return { statusCode: 200, body: 'received (erreur interne, voir logs)' };
  }
};
