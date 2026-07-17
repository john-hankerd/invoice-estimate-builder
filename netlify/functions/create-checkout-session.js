// netlify/functions/create-checkout-session.js
// Called from login.html right after a business signs up. Creates a Stripe
// Checkout Session (subscription mode, 30-day trial, card required) and
// returns the URL to redirect to.

const https = require("https");
const querystring = require("querystring");

// ─── CONFIG (Environment Variables in Netlify) ──────────────────────────────
// STRIPE_SECRET_KEY  — Stripe live secret key (sk_live_...)
// STRIPE_PRICE_ID    — the $20/mo recurring price ID
// ─────────────────────────────────────────────────────────────────────────────

function stripePost(path, body) {
  return new Promise((resolve, reject) => {
    const data = querystring.stringify(body);
    const options = {
      hostname: "api.stripe.com",
      path,
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: "Invalid JSON" };
  }

  const { uid, email, successUrl, cancelUrl } = payload;

  if (!uid || !email || !successUrl || !cancelUrl) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing uid, email, successUrl, or cancelUrl" }),
    };
  }

  const sessionParams = {
    mode: "subscription",
    "payment_method_types[]": "card",
    "line_items[0][price]": process.env.STRIPE_PRICE_ID,
    "line_items[0][quantity]": "1",
    customer_email: email,
    client_reference_id: uid,
    success_url: successUrl,
    cancel_url: cancelUrl,
    "subscription_data[trial_period_days]": "30",
    "subscription_data[metadata][uid]": uid,
    "metadata[uid]": uid,
  };

  try {
    const result = await stripePost("/v1/checkout/sessions", sessionParams);
    if (result.status !== 200) {
      console.error("Stripe error:", result.body);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Stripe error", details: result.body }),
      };
    }
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ checkout_url: result.body.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
