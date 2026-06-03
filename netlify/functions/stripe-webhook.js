const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
      // Créer le compte Auth Supabase
      const { data: authData } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: 'https://app.waneyo-formation.com',
        data: { stripe_customer_id: customerId }
      });

      // Enregistrer dans la table subscribers
      await supabase.from('subscribers').upsert(
        { email, stripe_customer_id: customerId, status: 'active' },
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
