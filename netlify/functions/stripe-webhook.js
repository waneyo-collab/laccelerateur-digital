const stripeLib = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { sendGuideEmail, logGuidePurchase } = require('./_guide-delivery');

// ── Initialisation défensive : si une variable d'env manque, on ne crashe pas
//    le module (ce qui ferait planter TOUTES les requêtes avec un 502), on le
//    consigne et on répond proprement à la requête.
let stripe = null;
let supabase = null;
let initError = null;

try {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY manquant');
  stripe = stripeLib(process.env.STRIPE_SECRET_KEY);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant');
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
} catch (err) {
  initError = err;
  console.error('❌ Erreur d\'initialisation du webhook Stripe:', err.message);
}

async function sendWelcomeEmail(email, firstName, setupLink) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Nadia — Waneyo Formation <contact@waneyo-formation.com>',
        to: email,
        subject: '🎉 Bienvenue dans L\'Accélérateur Digital — Créez votre mot de passe',
        html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px;background:#0F0A1E;font-family:sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#1a1035;border-radius:16px;padding:32px">
    <div style="font-size:22px;font-weight:800;color:#7C3AED;margin-bottom:16px">Waneyo Formation</div>
    <h2 style="color:#fff;font-size:20px;margin-bottom:16px">Bienvenue ${firstName ? firstName : ''} ! 🎉</h2>
    <p style="color:rgba(255,255,255,0.8);line-height:1.7;margin-bottom:16px">
      Votre abonnement à <strong>L'Accélérateur Digital</strong> est confirmé. Il ne vous reste qu'une étape : créer votre mot de passe pour accéder à votre formation.
    </p>
    <a href="${setupLink}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;margin-bottom:24px">
      👉 Créer mon mot de passe
    </a>
    <div style="background:rgba(124,58,237,0.15);border-left:4px solid #7C3AED;padding:16px;border-radius:8px;margin-bottom:24px">
      <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px;line-height:1.6">
        💡 Ce lien expire dans <strong>24h</strong>. Vérifiez vos spams si vous ne voyez pas cet email.
      </p>
    </div>
    <p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:0">
      En cas de question, répondez simplement à cet email.<br/><br/>
      À tout de suite,<br/>
      <strong style="color:#fff">Nadia — Waneyo Formation</strong>
    </p>
  </div>
</body>
</html>`
      })
    });
    if (!res.ok) console.error('❌ Erreur Resend:', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('❌ Exception lors de l\'envoi de l\'email de bienvenue:', err.message);
    return false;
  }
}

async function generateSetupLink(email, isNewUser) {
  try {
    // Nouveaux users → 'invite' : lien direct sans redirection serveur
    // Users existants → 'recovery' : seule option disponible
    const type = isNewUser ? 'invite' : 'recovery';
    const { data, error } = await supabase.auth.admin.generateLink({
      type,
      email,
      options: { redirectTo: 'https://app.waneyo-formation.com' }
    });
    if (error) { console.error('❌ generateLink error:', error.message); return null; }
    const actionLink = data?.properties?.action_link;
    if (!actionLink) return null;
    // On ne met jamais le lien Supabase brut dans l'email : les scanners de
    // sécurité (Gmail, Outlook Safe Links, etc.) "pré-cliquent" les liens des
    // emails pour les vérifier, ce qui consomme le token à usage unique avant
    // que l'utilisateur réel ne clique (erreur "otp_expired"). En passant par
    // confirm.html, seul un vrai clic humain déclenche la validation.
    return `https://app.waneyo-formation.com/confirm.html?confirmation_url=${encodeURIComponent(actionLink)}`;
  } catch (err) {
    console.error('❌ Exception generateSetupLink:', err.message);
    return null;
  }
}

exports.handler = async (event) => {
  // Config invalide (variable d'env manquante) → on répond proprement au lieu de crasher
  if (initError) {
    console.error('❌ Webhook appelé avec une config invalide:', initError.message);
    return { statusCode: 500, body: `Configuration serveur invalide: ${initError.message}` };
  }

  // Vérification de la signature Stripe
  let stripeEvent;
  try {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      event.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Signature invalide:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Tout le traitement métier est protégé : une erreur ici ne doit JAMAIS
  // faire planter la fonction (= 502 côté Stripe). On logue et on répond 200
  // pour éviter que Stripe ne boucle indéfiniment sur un event bloqué.
  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const email = session.customer_details?.email;
      const customerId = session.customer;

      // ── Achat unique (le Guide Marketing) : pas de compte créé, juste l'email
      //    de livraison avec le lien de téléchargement sécurisé.
      if (session.mode === 'payment') {
        if (email) {
          const fullName = session.customer_details?.name || '';
          const firstName = fullName.split(' ')[0] || '';
          // Identification par l'ID du Payment Link, déjà présent dans
          // l'événement reçu (pas d'appel API Stripe supplémentaire requis).
          const isGuidePurchase = session.payment_link === process.env.GUIDE_STRIPE_PAYMENT_LINK_ID;

          if (isGuidePurchase) {
            const sent = await sendGuideEmail(supabase, email, firstName);
            if (!sent) console.error(`❌ Email guide NON envoyé pour ${email}`);
            await logGuidePurchase(supabase, { email, psp: 'stripe', amount: (session.amount_total || 0) / 100 });
          } else {
            console.error(`⚠️ Paiement one-time non reconnu (ni guide) pour ${email}`);
          }
        }
        return { statusCode: 200, body: 'ok' };
      }

      // ── Abonnement : flux existant inchangé (création de compte + email) ──
      if (email) {
        const fullName = session.customer_details?.name || '';
        const firstName = fullName.split(' ')[0] || '';

        // 1. Créer le compte Supabase — détecter si user nouveau ou existant
        //    Robuste : peu importe le message exact renvoyé par Supabase,
        //    un échec de création = on suppose que le compte existe déjà.
        let isNewUser = true;
        const { error: createError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { stripe_customer_id: customerId, first_name: firstName }
        });
        if (createError) {
          console.error('❌ createUser error (compte probablement déjà existant):', createError.message || createError);
          isNewUser = false;
        }

        // 2. Générer le lien adapté
        const setupLink = await generateSetupLink(email, isNewUser);

        // 3. Enregistrer dans subscribers (indépendant du succès du lien/email)
        const { error: upsertError } = await supabase.from('subscribers').upsert(
          { email, stripe_customer_id: customerId, status: 'active', first_name: firstName },
          { onConflict: 'email' }
        );
        if (upsertError) console.error('❌ Erreur upsert subscribers:', upsertError.message);

        // 4. Email unique bienvenue + création mot de passe
        if (setupLink) {
          const sent = await sendWelcomeEmail(email, firstName, setupLink);
          if (!sent) console.error(`❌ Email de bienvenue NON envoyé pour ${email}`);
        } else {
          console.error(`❌ Pas de lien généré, email de bienvenue NON envoyé pour ${email}`);
        }
      }
    }

    if (stripeEvent.type === 'customer.subscription.deleted') {
      const sub = stripeEvent.data.object;
      const { error } = await supabase
        .from('subscribers')
        .update({ status: 'cancelled' })
        .eq('stripe_customer_id', sub.customer);
      if (error) console.error('❌ Erreur update subscribers (cancel):', error.message);
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Erreur inattendue dans le traitement du webhook:', err.message, err.stack);
    // On répond 200 quand même : Stripe arrête de boucler, l'erreur reste
    // visible dans les logs Netlify pour diagnostic.
    return { statusCode: 200, body: 'received (erreur interne, voir logs)' };
  }
};
