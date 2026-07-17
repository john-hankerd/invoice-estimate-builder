// netlify/functions/create-invoice-payment.js
// Called from the "Pay Now" button on the public view.html page. Creates a
// one-time Stripe Checkout Session that pays the connected business
// directly (a destination charge) — this app's Stripe account never holds
// the money, it just routes the payment to the right connected account.

const https = require("https");
const querystring = require("querystring");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = admin.firestore();

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

  const { docId, successUrl, cancelUrl } = payload;
  if (!docId || !successUrl || !cancelUrl) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing docId, successUrl, or cancelUrl" }) };
  }

  const docSnap = await db.collection("docs").doc(docId).get();
  if (!docSnap.exists) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: "Not found" }) };
  }
  const docData = docSnap.data();

  if (docData.type !== "invoice" || !["sent", "overdue"].includes(docData.status)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "This invoice can't be paid right now" }) };
  }

  const ownerSnap = await db.collection("users").doc(docData.ownerUid).get();
  const owner = ownerSnap.data();
  if (!owner?.stripeConnectOnboarded || !owner?.stripeConnectAccountId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "This business hasn't finished setting up online payments yet" }) };
  }

  const sessionParams = {
    mode: "payment",
    "payment_method_types[]": "card",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": `Invoice #${docData.number} — ${owner.businessName || ""}`,
    "line_items[0][price_data][unit_amount]": String(docData.totalCents),
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "payment_intent_data[transfer_data][destination]": owner.stripeConnectAccountId,
    "metadata[docId]": docId,
    "payment_intent_data[metadata][docId]": docId,
  };

  try {
    const result = await stripePost("/v1/checkout/sessions", sessionParams);
    if (result.status !== 200) {
      console.error("Stripe error:", result.body);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Stripe error", details: result.body }) };
    }
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ checkout_url: result.body.url }),
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
