// netlify/functions/stripe-webhook.js
// Handles Stripe webhook events — creates license on successful payment

const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Handle base64 encoded body (Netlify sometimes encodes binary)
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

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_email || session.metadata?.email;

    console.log('Processing payment for:', email);

    if (!email) {
      console.error('No email found in session:', JSON.stringify(session));
      return { statusCode: 400, body: 'No email in session' };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    try {
      // Check if user already exists
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email === email);

      let userId;

      if (existingUser) {
        userId = existingUser.id;
        console.log('Found existing user:', userId);
        await supabase.from('profiles').upsert({ id: userId, email });
      } else {
        // Create new user with temp password
        const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
        });
        if (createError) {
          console.error('Error creating user:', createError);
          throw createError;
        }
        userId = newUser.user.id;
        console.log('Created new user:', userId);

        // Create profile
        await supabase.from('profiles').insert({ id: userId, email });

        // Send password reset so user can set their own password
        const { error: resetError } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: {
            redirectTo: 'https://edpstudy.com',
          }
        });
        if (resetError) console.error('Reset email error (non-fatal):', resetError.message);
      }

      // Check for existing active license to avoid duplicates
      const now = new Date().toISOString();
      const { data: existingLicense } = await supabase
        .from('licenses')
        .select('id')
        .eq('user_id', userId)
        .eq('stripe_session_id', session.id)
        .single();

      if (existingLicense) {
        console.log('License already exists for this session, skipping');
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
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

      if (licenseError) {
        console.error('License insert error:', licenseError);
        throw licenseError;
      }

      console.log(`✅ License created for ${email}, expires ${expiresAt.toISOString()}`);

    } catch (err) {
      console.error('Error processing webhook:', err);
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
