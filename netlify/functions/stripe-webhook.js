// netlify/functions/stripe-webhook.js
// Handles Stripe webhook events — creates and revokes licenses

const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('Webhook received:', stripeEvent.type);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // ── Payment completed → create license ───────────────────────
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_email || session.metadata?.email;

    console.log('Processing payment for:', email);

    if (!email) {
      console.error('No email found in session');
      return { statusCode: 400, body: 'No email in session' };
    }

    try {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email === email);

      let userId;

      if (existingUser) {
        userId = existingUser.id;
        console.log('Found existing user:', userId);
        await supabase.from('profiles').upsert({ id: userId, email });
      } else {
        const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
        });
        if (createError) throw createError;
        userId = newUser.user.id;
        console.log('Created new user:', userId);

        await supabase.from('profiles').insert({ id: userId, email });

        const { error: resetError } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: 'https://www.studyedp.com' }
        });
        if (resetError) console.error('Reset email error (non-fatal):', resetError.message);
      }

      // Avoid duplicate licenses for same session
      const { data: existingLicense } = await supabase
        .from('licenses')
        .select('id')
        .eq('stripe_session_id', session.id)
        .single();

      if (existingLicense) {
        console.log('License already exists for this session, skipping');
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      }

      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 2);

      const { error: licenseError } = await supabase.from('licenses').insert({
        user_id: userId,
        stripe_session_id: session.id,
        status: 'active',
        expires_at: expiresAt.toISOString(),
      });

      if (licenseError) throw licenseError;
      console.log(`✅ License created for ${email}, expires ${expiresAt.toISOString()}`);


    } catch (err) {
      console.error('Error creating license:', err);
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── Refund issued → revoke license ───────────────────────────
  if (stripeEvent.type === 'charge.refunded') {
    const charge = stripeEvent.data.object;
    const email = charge.billing_details?.email || charge.receipt_email;

    console.log('Refund issued for:', email, 'payment intent:', charge.payment_intent);

    if (!charge.payment_intent) {
      console.log('No payment intent on charge, skipping');
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    try {
      // Find the checkout session that matches this payment intent
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: charge.payment_intent,
        limit: 1,
      });

      const sessionId = sessions.data[0]?.id;

      if (sessionId) {
        // Revoke by stripe_session_id
        const { error } = await supabase
          .from('licenses')
          .update({ status: 'revoked' })
          .eq('stripe_session_id', sessionId);

        if (error) throw error;
        console.log(`🚫 License revoked for session ${sessionId}`);
      } else if (email) {
        // Fallback: revoke by email if we can't find the session
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const user = existingUsers?.users?.find(u => u.email === email);
        if (user) {
          const { error } = await supabase
            .from('licenses')
            .update({ status: 'revoked' })
            .eq('user_id', user.id)
            .eq('status', 'active');
          if (error) throw error;
          console.log(`🚫 License revoked for user ${email}`);
        }
      }

    } catch (err) {
      console.error('Error revoking license:', err);
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
