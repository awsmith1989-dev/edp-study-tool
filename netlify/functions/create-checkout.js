// netlify/functions/create-checkout.js
// Creates a Stripe Checkout session for license purchase.
// Promotion codes are entered on Stripe's hosted checkout page.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,

      // Shows an "Add promotion code" field on the Stripe checkout page.
      // Stripe validates the code, applies the discount, and displays the
      // adjusted total before payment.
      allow_promotion_codes: true,

      payment_intent_data: {
        receipt_email: email,
      },
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      success_url: 'https://www.studyedp.com/app.html?purchase=success',
      cancel_url: 'https://www.studyedp.com/?purchase=cancelled',
      metadata: { email },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('create-checkout error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
