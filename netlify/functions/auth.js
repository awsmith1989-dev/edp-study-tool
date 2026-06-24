// netlify/functions/auth.js
// Handles login and returns license status

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { action, email, password } = JSON.parse(event.body || '{}');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    if (action === 'login') {
      // Sign in with email/password using admin client
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const userId = data.user.id;

      // Check for active license
      const now = new Date().toISOString();
      const { data: license } = await supabase
        .from('licenses')
        .select('id, expires_at, status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gte('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .single();

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: { id: userId, email: data.user.email },
          session: data.session,
          license: license || null,
        }),
      };

    } else if (action === 'check') {
      // Check license by user id (passed as JWT)
      const authHeader = event.headers['authorization'];
      if (!authHeader) throw new Error('No auth token');

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) throw new Error('Invalid token');

      const now = new Date().toISOString();
      const { data: license } = await supabase
        .from('licenses')
        .select('id, expires_at, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gte('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .single();

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: { id: user.id, email: user.email },
          license: license || null,
        }),
      };

    } else if (action === 'register') {
      // Register new account (for users who purchased and need to set password)
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      // Create profile
      if (data.user) {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          email,
        });
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, user: data.user }),
      };

    } else if (action === 'set-password') {
      // User clicked reset link — use their token to set a new password
      const { token, password } = JSON.parse(event.body || '{}');
      if (!token || !password) throw new Error('Token and password required');

      // Get user from token
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) throw new Error('Invalid or expired reset link. Please request a new one.');

      // Update password using admin
      const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
      if (updateError) throw updateError;

      // Check for active license
      const now = new Date().toISOString();
      const { data: license } = await supabase
        .from('licenses')
        .select('id, expires_at, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gte('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .single();

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: { id: user.id, email: user.email }, license: license || null }),
      };

    } else if (action === 'reset-password') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://edpstudy.com',
      });
      if (error) throw error;
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      };

    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
    }

  } catch (err) {
    console.error('auth error:', err);
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
