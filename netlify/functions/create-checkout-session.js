// netlify/functions/create-checkout-session.js
// Called from choose-plan.html when a business decides to add a card — either
// voluntarily during their free trial, or because the trial ended. The free
// 30-day trial itself is granted directly in Firestore at signup with no card
// (see login.html) — this only runs once someone actually adds a card. If
// `trialEndsAt` is still in the future, the first charge is deferred to that
// exact date so they aren't billed early; otherwise it charges immediately.

const https = require("https");
const querystring = require("querystring");

// ─── CONFIG (Environment Variables in Netlify) ──────────────────────────────
// STRIPE_SECRET_KEY      — Stripe live secret key (sk_live_...)
// STRIPE_PRICE_MONTHLY   — the $20/mo recurring price ID
// STRIPE_PRICE_ANNUAL    — the $200/yr recurring price ID (2 months free vs monthly)
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

  const { uid, email, plan, trialEndsAt, successUrl, cancelUrl } = payload;

  if (!uid || !email || !successUrl || !cancelUrl) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing uid, email, successUrl, or cancelUrl" }),
    };
  }

  const priceId = plan === "annual" ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;

  const sessionParams = {
    mode: "subscription",
    "payment_method_types[]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    customer_email: email,
    client_reference_id: uid,
    success_url: successUrl,
    cancel_url: cancelUrl,
    "subscription_data[metadata][uid]": uid,
    "subscription_data[metadata][plan]": plan || "monthly",
    "metadata[uid]": uid,
  };

  // Only defer the first charge if the app-granted free trial hasn't ended
  // yet. Stripe requires trial_end to be at least 48 hours out.
  const trialEndMs = trialEndsAt ? new Date(trialEndsAt).getTime() : 0;
  if (trialEndMs > Date.now() + 48 * 60 * 60 * 1000) {
    sessionParams["subscription_data[trial_end]"] = String(Math.floor(trialEndMs / 1000));
  }

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
