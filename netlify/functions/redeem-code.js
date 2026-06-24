// netlify/functions/redeem-code.js
// Redeems a bulk auth code and creates a license for the user

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    // Verify the user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Invalid token');

    // Find the code
    const { data: authCode, error: codeError } = await supabase
      .from('auth_codes')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .single();

    if (codeError || !authCode) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Code not found. Please check and try again.' }),
      };
    }

    if (authCode.redeemed) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'This code has already been redeemed.' }),
      };
    }

    const now = new Date();
    if (new Date(authCode.expires_at) < now) {
      return {
        statusCode: 410,
        body: JSON.stringify({ error: 'This code has expired.' }),
      };
    }

    // Check user doesn't already have an active license
    const { data: existingLicense } = await supabase
      .from('licenses')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', now.toISOString())
      .single();

    if (existingLicense) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'You already have an active license.' }),
      };
    }

    // Mark code as redeemed
    await supabase
      .from('auth_codes')
      .update({
        redeemed: true,
        redeemed_by: user.id,
        redeemed_at: now.toISOString(),
      })
      .eq('id', authCode.id);

    // Create license using the code's expiry date
    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .insert({
        user_id: user.id,
        auth_code: code.trim().toUpperCase(),
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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
