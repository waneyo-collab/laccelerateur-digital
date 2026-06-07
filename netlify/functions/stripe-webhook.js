const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendWelcomeEmail(email, firstName, setupLink) {
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
  if (!res.ok) console.error('Resend error:', await res.text());
}

async function generateSetupLink(email, isNewUser) {
  // Nouveaux users → 'invite' : lien direct sans redirection serveur
  // Users existants → 'recovery' : seule option disponible
  const type = isNewUser ? 'invite' : 'recovery';
  const { data, error } = await supabase.auth.admin.generateLink({
    type,
    email,
    options: { redirectTo: 'https://app.waneyo-formation.com' }
  });
  if (error) { console.error('generateLink error:', error); return null; }
  return data?.properties?.action_link || null;
}

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email;
    const customerId = session.customer;

    if (email) {
      const fullName = session.customer_details?.name || '';
      const firstName = fullName.split(' ')[0] || '';

      // 1. Créer le compte Supabase — détecter si user nouveau ou existant
      const { error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { stripe_customer_id: customerId, first_name: firstName }
      });
      const isNewUser = !createError || createError.message === 'User already registered' ? !createError : false;

      // 2. Générer le lien adapté
      const setupLink = await generateSetupLink(email, isNewUser);
      if (!setupLink) return { statusCode: 500, body: 'Could not generate setup link' };

      // 3. Enregistrer dans subscribers
      await supabase.from('subscribers').upsert(
        { email, stripe_customer_id: customerId, status: 'active', first_name: firstName },
        { onConflict: 'email' }
      );

      // 4. Email unique bienvenue + création mot de passe
      await sendWelcomeEmail(email, firstName, setupLink);
    }
  }

  if (stripeEvent.type === 'customer.subscription.deleted') {
    const sub = stripeEvent.data.object;
    await supabase
      .from('subscribers')
      .update({ status: 'cancelled' })
      .eq('stripe_customer_id', sub.customer);
  }

  return { statusCode: 200, body: 'ok' };
};
