const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendGuideEmail, logGuidePurchase } = require('./_guide-delivery');
const { generateSetupLink, sendWelcomeEmail, ensureAccount } = require('./_account-setup');

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

// Récupère l'email d'un client Paddle à partir de son customer_id (appel API).
async function fetchCustomerEmailById(customerId) {
  if (!customerId) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.paddle.com/customers/${customerId}`, {
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
    console.error('❌ Exception fetchCustomerEmailById:', err.name, err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// L'email n'est pas toujours présent dans le payload transaction.* : on le
// récupère via l'API Paddle à partir du customer_id si besoin.
async function getCustomerEmail(transaction) {
  if (transaction.customer?.email) return transaction.customer.email;
  return fetchCustomerEmailById(transaction.customer_id);
}

// Première transaction d'un abonnement (ou renouvellement) : crée le compte
// si besoin et upsert la ligne subscribers — même logique que stripe-webhook.js.
async function handleSubscriptionPayment(transaction) {
  const email = await getCustomerEmail(transaction);
  if (!email) {
    console.error('❌ Impossible de récupérer l\'email du client Paddle pour l\'abonnement', transaction.id);
    return;
  }

  // 1. Créer le compte Supabase — détecter si user nouveau ou existant
  const isNewUser = await ensureAccount(supabase, email, { paddle_customer_id: transaction.customer_id });

  // 2. Générer le lien adapté
  const setupLink = await generateSetupLink(supabase, email, isNewUser);

  // 3. Enregistrer/raffraîchir dans subscribers (indépendant du succès du lien/email)
  const { error: upsertError } = await supabase.from('subscribers').upsert(
    { email, paddle_customer_id: transaction.customer_id, status: 'active' },
    { onConflict: 'email' }
  );
  if (upsertError) console.error('❌ Erreur upsert subscribers (Paddle):', upsertError.message);

  // 4. Email de bienvenue uniquement à la création du compte (pas à chaque
  //    renouvellement mensuel, sinon l'abonné le reçoit chaque mois).
  if (isNewUser) {
    if (setupLink) {
      const sent = await sendWelcomeEmail(email, '', setupLink);
      if (!sent) console.error(`❌ Email de bienvenue NON envoyé pour ${email}`);
    } else {
      console.error(`❌ Pas de lien généré, email de bienvenue NON envoyé pour ${email}`);
    }
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
      } else if (transaction.subscription_id) {
        // Transaction liée à un abonnement récurrent (premier paiement ou
        // renouvellement mensuel) — jusqu'ici totalement ignorée, ce qui
        // empêchait toute création de compte pour les abonnés Paddle.
        await handleSubscriptionPayment(transaction);
      }
    }

    // Annulation d'abonnement — même comportement que customer.subscription.deleted côté Stripe.
    if (paddleEvent.event_type === 'subscription.canceled') {
      const subscription = paddleEvent.data;
      const email = await fetchCustomerEmailById(subscription.customer_id);
      if (email) {
        const { error } = await supabase
          .from('subscribers')
          .update({ status: 'cancelled' })
          .eq('email', email);
        if (error) console.error('❌ Erreur update subscribers (cancel Paddle):', error.message);
      } else {
        console.error('❌ Impossible de récupérer l\'email pour annuler l\'abonnement Paddle', subscription.id);
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Erreur inattendue webhook Paddle:', err.message, err.stack);
    return { statusCode: 200, body: 'received (erreur interne, voir logs)' };
  }
};
