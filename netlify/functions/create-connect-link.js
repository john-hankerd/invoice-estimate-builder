// netlify/functions/create-connect-link.js
// Lets a business connect their own Stripe account so their customers' invoice
// payments go straight to them (not through this app's Stripe account).
// Creates a Stripe Connect Express account on first use, then always returns
// a fresh onboarding/update link for it.
//
// Requires Stripe Connect to be enabled on the platform account
// (one-time manual step at dashboard.stripe.com/connect) — until then this
// will fail with a Stripe "signed up for Connect" error.

const https = require("https");
const querystring = require("querystring");
const admin = require("firebase-admin");

// ─── CONFIG (Environment Variables in Netlify) ──────────────────────────────
// STRIPE_SECRET_KEY            — Stripe live secret key
// FIREBASE_SERVICE_ACCOUNT_KEY — full JSON service account key, as a string
// ─────────────────────────────────────────────────────────────────────────────

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = admin.firestore();

function stripeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? querystring.stringify(body) : "";
    const options = {
      hostname: "api.stripe.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let resBody = "";
      res.on("data", (chunk) => (resBody += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resBody) });
        } catch (e) {
          resolve({ status: res.statusCode, body: resBody });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
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

  const { uid, returnUrl, refreshUrl } = payload;
  if (!uid || !returnUrl || !refreshUrl) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing uid, returnUrl, or refreshUrl" }),
    };
  }

  try {
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: "User not found" }) };
    }

    let accountId = userSnap.data().stripeConnectAccountId;

    if (!accountId) {
      const email = userSnap.data().email;
      const acctResult = await stripeRequest("POST", "/v1/accounts", {
        type: "express",
        email,
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
        "metadata[uid]": uid,
      });
      if (acctResult.status !== 200) {
        console.error("Stripe account create error:", acctResult.body);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Stripe error", details: acctResult.body }),
        };
      }
      accountId = acctResult.body.id;
      await userRef.set({ stripeConnectAccountId: accountId }, { merge: true });
    }

    const linkResult = await stripeRequest("POST", "/v1/account_links", {
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    if (linkResult.status !== 200) {
      console.error("Stripe account link error:", linkResult.body);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Stripe error", details: linkResult.body }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ url: linkResult.body.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
