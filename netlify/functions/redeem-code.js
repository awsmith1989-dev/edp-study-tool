// netlify/functions/redeem-code.js
// Redeems a cohort access code and creates a license.
// If the code isn't a cohort code but IS a valid Stripe promotion code,
// tells the user where it actually belongs instead of failing blankly.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers['authorization'];
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  const { code } = JSON.parse(event.body || '{}');
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Code required' }) };
  }

  const clean = code.trim().toUpperCase();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Invalid token');

    const { data: authCode } = await supabase
      .from('auth_codes')
      .select('*')
      .eq('code', clean)
      .single();

    // ── Not a cohort code — is it a Stripe promotion code? ──────
    if (!authCode) {
      let isPromo = false;
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        // Stripe promotion codes are case-insensitive on redemption but
        // stored as entered; check both the raw and uppercased forms.
        for (const candidate of [code.trim(), clean]) {
          const found = await stripe.promotionCodes.list({ code: candidate, active: true, limit: 1 });
          if (found.data.length) { isPromo = true; break; }
        }
      } catch (e) {
        console.error('Stripe promo lookup failed (non-fatal):', e.message);
      }

      if (isPromo) {
        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: "That's a discount code, not a cohort access code. Discount codes are applied at checkout — continue to payment and enter it there.",
            isPromotionCode: true,
          }),
        };
      }

      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Code not found. Check the code and try again, or contact your program coordinator.' }),
      };
    }

    if (authCode.redeemed) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This code has already been redeemed.' }) };
    }

    const now = new Date();
    if (new Date(authCode.expires_at) < now) {
      return { statusCode: 410, body: JSON.stringify({ error: 'This code has expired.' }) };
    }

    const { data: existingLicense } = await supabase
      .from('licenses')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', now.toISOString())
      .single();

    if (existingLicense) {
      return { statusCode: 409, body: JSON.stringify({ error: 'You already have an active license.' }) };
    }

    await supabase
      .from('auth_codes')
      .update({ redeemed: true, redeemed_by: user.id, redeemed_at: now.toISOString() })
      .eq('id', authCode.id);

    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .insert({
        user_id: user.id,
        auth_code: clean,
        status: 'active',
        expires_at: authCode.expires_at,
      })
      .select()
      .single();

    if (licenseError) throw licenseError;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, license }),
    };

  } catch (err) {
    console.error('redeem-code error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
