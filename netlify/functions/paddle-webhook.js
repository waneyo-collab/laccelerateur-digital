const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendGuideEmail, logGuidePurchase } = require('./_guide-delivery');
const { generateSetupLink, sendWelcomeEmail, ensureAccount } = require('./_account-setup');

// ── Initialisation défensive
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

// Vérification de la signature Paddle
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const match = signatureHeader.match(/^ts=(\d+);h1=([a-f0-9]+)$/);
  if (!match) return false;
  const [, ts, h1] = match;

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

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(h1));
}

// Récupère l'email via l'API Paddle si absent du payload
async function fetchCustomerEmailById(customerId) {
  if (!customerId) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.paddle.com/customers/${customerId}`, {
      headers: { 'Authorization': `Bearer ${process.env.PADDLE_API_KEY}` },
      signal: controller.signal
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.email || null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCustomerEmail(transaction) {
  if (transaction.customer?.email) return transaction.customer.email;
  return fetchCustomerEmailById(transaction.customer_id);
}

// ── FLUX DE L'APPLICATION (Paiement unique)
async function handleAppPayment(transaction) {
  const email = await getCustomerEmail(transaction);
  if (!email) {
    console.error('❌ Impossible de récupérer l\'email du client Paddle pour l\'application', transaction.id);
    return;
  }

  const fullName = transaction.customer?.name || '';
  const firstName = fullName.split(' ')[0] || '';

  // 1. Créer le compte Supabase
  const isNewUser = await ensureAccount(supabase, email, { paddle_customer_id: transaction.customer_id });
  
  // 2. Générer le lien de configuration
  const setupLink = await generateSetupLink(supabase, email, isNewUser);

  // 3. Enregistrer l'accès dans la table subscribers
  const { error: upsertError } = await supabase.from('subscribers').upsert(
    { email, paddle_customer_id: transaction.customer_id, status: 'active', first_name: firstName },
    { onConflict: 'email' }
  );
  if (upsertError) console.error('❌ Erreur upsert subscribers (Paddle):', upsertError.message);

  // 4. Envoyer l'email de bienvenue avec le lien d'accès
  if (setupLink) {
    const sent = await sendWelcomeEmail(email, firstName, setupLink);
    if (!sent) console.error(`❌ Email de bienvenue NON envoyé pour ${email}`);
  }
}

exports.handler = async (event) => {
  if (initError) {
    return { statusCode: 500, body: `Configuration serveur invalide: ${initError.message}` };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const signatureHeader = event.headers['paddle-signature'] || event.headers['Paddle-Signature'];

  if (!verifySignature(rawBody, signatureHeader)) {
    return { statusCode: 400, body: 'Signature invalide' };
  }

  let paddleEvent;
  try {
    paddleEvent = JSON.parse(rawBody);
  } catch (err) {
    return { statusCode: 400, body: 'JSON invalide' };
  }

  try {
    if (paddleEvent.event_type === 'transaction.completed') {
      const transaction = paddleEvent.data;
      const priceId = transaction.items?.[0]?.price?.id || transaction.items?.[0]?.price_id;

      if (priceId === process.env.GUIDE_PADDLE_PRICE_ID) {
        // Flux du Guide Marketing (inchangé)
        const email = await getCustomerEmail(transaction);
        if (email) {
          const sent = await sendGuideEmail(supabase, email, '');
          if (!sent) console.error(`❌ Email guide NON envoyé pour ${email}`);
          const amount = transaction.details?.totals?.total ? Number(transaction.details.totals.total) / 100 : 0;
          await logGuidePurchase(supabase, { email, psp: 'paddle', amount });
        }
      } else {
        // Tout autre achat sur Paddle est désormais considéré comme l'accès unique à l'application
        await handleAppPayment(transaction);
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Erreur inattendue webhook Paddle:', err.message);
    return { statusCode: 200, body: 'received' };
  }
};
