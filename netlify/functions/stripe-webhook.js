const stripeLib = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { sendGuideEmail, logGuidePurchase } = require('./_guide-delivery');
const { generateSetupLink, sendWelcomeEmail, ensureAccount } = require('./_account-setup');

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
  if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const email = session.customer_details?.email;
      const customerId = session.customer;
      const fullName = session.customer_details?.name || '';
      const firstName = fullName.split(' ')[0] || '';

      if (email) {
        // ── Ici on gère TOUS les paiements uniques (Guide ET Application) ──
        if (session.mode === 'payment') {
          const isGuidePurchase = session.payment_link === process.env.GUIDE_STRIPE_PAYMENT_LINK_ID;

          if (isGuidePurchase) {
            // Flux du Guide Marketing (inchangé)
            const sent = await sendGuideEmail(supabase, email, firstName);
            if (!sent) console.error(`❌ Email guide NON envoyé pour ${email}`);
            await logGuidePurchase(supabase, { email, psp: 'stripe', amount: (session.amount_total || 0) / 100 });
          } else {
            // FLUX DE L'APPLICATION (Puisque ce n'est pas le guide, c'est l'app !)
            // 1. Créer le compte Supabase
            const isNewUser = await ensureAccount(supabase, email, { stripe_customer_id: customerId, first_name: firstName });
            
            // 2. Générer le lien de configuration du mot de passe
            const setupLink = await generateSetupLink(supabase, email, isNewUser);
            
            // 3. Enregistrer l'accès dans la table subscribers
            const { error: upsertError } = await supabase.from('subscribers').upsert(
              { email, stripe_customer_id: customerId, status: 'active', first_name: firstName },
              { onConflict: 'email' }
            );
            if (upsertError) console.error('❌ Erreur upsert subscribers:', upsertError.message);

            // 4. Envoyer l'email de bienvenue avec le lien d'accès
            if (setupLink) {
              const sent = await sendWelcomeEmail(email, firstName, setupLink);
              if (!sent) console.error(`❌ Email de bienvenue NON envoyé pour ${email}`);
            }
          }
        }
      }
      return { statusCode: 200, body: 'ok' };
    }

      // ── Abonnement : flux existant inchangé (création de compte + email) ──
      if (email) {
        const fullName = session.customer_details?.name || '';
        const firstName = fullName.split(' ')[0] || '';

        // 1. Créer le compte Supabase — détecter si user nouveau ou existant
        const isNewUser = await ensureAccount(supabase, email, { stripe_customer_id: customerId, first_name: firstName });

        // 2. Générer le lien adapté
        const setupLink = await generateSetupLink(supabase, email, isNewUser);

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

   
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Erreur inattendue dans le traitement du webhook:', err.message, err.stack);
    // On répond 200 quand même : Stripe arrête de boucler, l'erreur reste
    // visible dans les logs Netlify pour diagnostic.
    return { statusCode: 200, body: 'received (erreur interne, voir logs)' };
  }
};
