// sync-users-to-hubspot.js
// One-time script to sync all existing Supabase users to HubSpot
// Run with: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... HUBSPOT_TOKEN=... node sync-users-to-hubspot.js

const { createClient } = require('@supabase/supabase-js');

// ── Config — set these as environment variables, never hardcode ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !HUBSPOT_TOKEN) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, HUBSPOT_TOKEN');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
};

async function upsertContact(email, licenseStatus, licenseExpiry) {
  const properties = {
    email,
    edp_license_status: licenseStatus,
    lifecyclestage: licenseStatus === 'licensed' ? 'customer' : 'lead',
    hs_lead_status: licenseStatus === 'licensed' ? 'IN_PROGRESS' : 'NEW',
  };

  if (licenseExpiry) {
    // HubSpot expects dates as midnight UTC timestamps in ms
    properties.edp_license_expiry = new Date(licenseExpiry).setHours(0,0,0,0).toString();
  }

  // Try to update existing contact first
  const patchRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
    { method: 'PATCH', headers, body: JSON.stringify({ properties }) }
  );

  if (patchRes.status === 404) {
    // Contact doesn't exist — create it
    const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ properties }),
    });
    const data = await createRes.json();
    if (!createRes.ok) throw new Error(data.message || 'Create failed');
    return { action: 'created', id: data.id };
  }

  const data = await patchRes.json();
  if (!patchRes.ok) throw new Error(data.message || 'Update failed');
  return { action: 'updated', id: data.id };
}

async function main() {
  console.log('\nFetching users from Supabase...');

  // Get all auth users
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  if (error) { console.error('Error fetching users:', error.message); process.exit(1); }
  console.log(`Found ${users.length} users\n`);

  // Get all active licenses
  const { data: licenses } = await supabase
    .from('licenses')
    .select('user_id, status, expires_at')
    .eq('status', 'active');

  const licenseMap = {};
  (licenses || []).forEach(l => { licenseMap[l.user_id] = l; });

  let created = 0, updated = 0, failed = 0;

  for (const user of users) {
    const license = licenseMap[user.id];
    const licenseStatus = license ? 'licensed' : 'trial';
    const licenseExpiry = license?.expires_at || null;

    try {
      const result = await upsertContact(user.email, licenseStatus, licenseExpiry);
      if (result.action === 'created') created++;
      else updated++;
      console.log(`✅ ${result.action}: ${user.email} (${licenseStatus})`);
    } catch (err) {
      failed++;
      console.error(`❌ Failed: ${user.email} — ${err.message}`);
    }

    // Rate limit: HubSpot allows 100 requests/10s — add small delay
    await new Promise(r => setTimeout(r, 120));
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Done. Created: ${created} · Updated: ${updated} · Failed: ${failed}`);
  console.log('─'.repeat(50));
}

main();
