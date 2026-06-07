const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendWelcomeEmail(email, firstName) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Nadia — Waneyo Formation <contact@waneyo-formation.com>',
      to: email,
      subject: '🎉 Bienvenue dans L\'Accélérateur Digital !',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0F0A1E;color:#fff;border-radius:16px">
          <div style="font-size:28px;font-weight:800;color:#7C3AED;margin-bottom:8px">Waneyo Formation</div>
          <h1 style="font-size:22px;font-weight:800;margin-bottom:16px">Bienvenue ${firstName ? firstName : ''} ! 🎉</h1>
          <p style="color:rgba(255,255,255,0.8);line-height:1.7;margin-bottom:16px">
            Votre abonnement à <strong>L'Accélérateur Digital</strong> est confirmé. Je suis ravie de vous accueillir dans la formation.
          </p>
          <p style="color:rgba(255,255,255,0.8);line-height:1.7;margin-bottom:24px">
            Vous allez recevoir dans quelques instants un email pour <strong>créer votre mot de passe</strong> et accéder à votre espace personnel.
          </p>
          <div style="background:rgba(124,58,237,0.15);border-left:4px solid #7C3AED;padding:16px;border-radius:8px;margin-bottom:24px">
            <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px;line-height:1.6">
              💡 <strong>Conseil :</strong> vérifiez vos spams si vous ne recevez pas l'email d'activation dans les 5 minutes.
            </p>
          </div>
          <p style="color:rgba(255,255,255,0.8);line-height:1.7;margin-bottom:8px">
            En cas de question, répondez simplement à cet email.
          </p>
          <p style="color:rgba(255,255,255,0.8);margin-bottom:0">
            À tout de suite,<br/>
            <strong>Nadia</strong><br/>
            <span style="color:rgba(255,255,255,0.5);font-size:13px">Fondatrice — Waneyo Formation</span>
          </p>
        </div>
      `
    })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', err);
  }
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

      // 1. Email de bienvenue Waneyo en premier
      await sendWelcomeEmail(email, firstName);

      // 2. Invitation Supabase (email création mot de passe)
      await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: 'https://app.waneyo-formation.com',
        data: { stripe_customer_id: customerId, first_name: firstName }
      });

      // 3. Enregistrement abonné
      await supabase.from('subscribers').upsert(
        { email, stripe_customer_id: customerId, status: 'active', first_name: firstName },
        { onConflict: 'email' }
      );
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
