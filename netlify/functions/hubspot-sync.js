// netlify/functions/hubspot-sync.js
// Syncs user events to HubSpot CRM — called after registration and purchase

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { action, email, properties } = JSON.parse(event.body || '{}');
  if (!email || !action) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email and action required' }) };
  }

  const TOKEN = process.env.HUBSPOT_API_TOKEN;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`,
  };

  try {
    // Map status values to HubSpot capitalized options
    const statusMap = { 'licensed': 'Licensed', 'trial': 'Trial', 'purchased': 'Licensed', 'expired': 'Expired', 'revoked': 'Revoked' };
    const mappedProperties = {};
    if (properties) {
      Object.entries(properties).forEach(([k, v]) => {
        mappedProperties[k] = k === 'edp_license_status' ? (statusMap[v] || v) : v;
      });
    }

    // ── Step 1: Upsert contact ────────────────────────────────
    const contactPayload = {
      properties: {
        email,
        hs_lead_status: action === 'purchase' ? 'IN_PROGRESS' : 'NEW',
        lifecyclestage: action === 'purchase' ? 'customer' : 'lead',
        ...mappedProperties,
      }
    };

    const contactRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts?idProperty=email`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(contactPayload),
      }
    );

    // If PATCH 404s (contact doesn't exist), create it
    let contactId;
    if (contactRes.status === 404) {
      const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify(contactPayload),
      });
      const createData = await createRes.json();
      contactId = createData.id;
    } else {
      const contactData = await contactRes.json();
      contactId = contactData.id;
    }

    console.log(`HubSpot contact upserted: ${email} (${action})`);

    // ── Step 2: Create deal on purchase ──────────────────────
    if (action === 'purchase' && contactId) {
      const dealRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            dealname: `EDP License — ${email}`,
            amount: '199',
            dealstage: 'closedwon',
            pipeline: 'default',
            closedate: new Date().toISOString().split('T')[0],
          },
          associations: [{
            to: { id: contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
          }]
        }),
      });
      const dealData = await dealRes.json();
      console.log(`HubSpot deal created: ${dealData.id}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };

  } catch (err) {
    console.error('HubSpot sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
