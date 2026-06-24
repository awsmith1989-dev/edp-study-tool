// netlify/functions/stripe-webhook.js
// Handles Stripe webhook events — creates license on successful payment

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_email || session.metadata?.email;

    if (!email) {
      console.error('No email found in session');
      return { statusCode: 400, body: 'No email in session' };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    try {
      // Create or get the auth user
      const { data: authData, error: authError } = await supabase.auth.admin.getUserByEmail(email);

      let userId;
      if (authError || !authData?.user) {
        // User doesn't exist yet — create them with a temp password they'll reset
        const tempPassword = Math.random().toString(36).slice(-12) + 'Aa1!';
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
        });
        if (createError) throw createError;
        userId = newUser.user.id;

        // Create profile
        await supabase.from('profiles').insert({ id: userId, email });

        // Send password reset email so user can set their own password
        await supabase.auth.admin.generateLink({
          type: 'recovery',
          email,
        });

      } else {
        userId = authData.user.id;
        // Ensure profile exists
        await supabase.from('profiles').upsert({ id: userId, email });
      }

      // Create 2-year license
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 2);

      const { error: licenseError } = await supabase.from('licenses').insert({
        user_id: userId,
        stripe_session_id: session.id,
        status: 'active',
        expires_at: expiresAt.toISOString(),
      });

      if (licenseError) throw licenseError;

      console.log(`License created for ${email}, expires ${expiresAt.toISOString()}`);

    } catch (err) {
      console.error('Error creating license:', err);
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
