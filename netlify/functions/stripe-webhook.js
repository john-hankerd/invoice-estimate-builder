// netlify/functions/stripe-webhook.js
// Stripe calls this when subscription events happen. Keeps each business's
// Firestore user doc (users/{uid}) in sync with their real billing status.
//
// This will also handle Stripe Connect payment events (a customer paying an
// invoice) once that piece is built — for now it only tracks the app's own
// $20/mo subscription.

const https = require("https");
const crypto = require("crypto");
const admin = require("firebase-admin");

// ─── CONFIG (Environment Variables in Netlify) ──────────────────────────────
// STRIPE_SECRET_KEY            — Stripe live secret key
// STRIPE_WEBHOOK_SECRET        — from the Stripe webhook endpoint (whsec_...)
// FIREBASE_SERVICE_ACCOUNT_KEY — full JSON service account key, as a string
// ─────────────────────────────────────────────────────────────────────────────

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = admin.firestore();

function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const parts = signature.split(",").reduce((acc, part) => {
      const [k, v] = part.split("=");
      acc[k] = v;
      return acc;
    }, {});
    if (!parts.t || !parts.v1) return false;

    const signedPayload = `${parts.t}.${payload}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    return crypto.timingSafeEqual(Buffer.from(parts.v1, "hex"), Buffer.from(expected, "hex"));
  } catch (e) {
    return false;
  }
}

function stripeGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.stripe.com",
      path,
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function updateUserFromSubscription(sub) {
  const uid = sub.metadata && sub.metadata.uid;
  if (!uid) {
    console.warn("Subscription has no uid in metadata:", sub.id);
    return;
  }
  await db.collection("users").doc(uid).set(
    {
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      plan: (sub.metadata && sub.metadata.plan) || "monthly",
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    },
    { merge: true }
  );
}

// Fires whenever a connected account's status changes, including as they
// move through Express onboarding. charges_enabled flipping true is what
// actually unlocks accepting online payments.
async function updateUserFromConnectAccount(account) {
  const uid = account.metadata && account.metadata.uid;
  if (!uid) {
    console.warn("Connect account has no uid in metadata:", account.id);
    return;
  }
  await db.collection("users").doc(uid).set(
    {
      stripeConnectAccountId: account.id,
      stripeConnectOnboarded: !!account.charges_enabled,
    },
    { merge: true }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const signature = event.headers["stripe-signature"];
  const isValid = verifyStripeSignature(event.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("Invalid Stripe signature");
    return { statusCode: 400, body: "Invalid signature" };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subResult = await stripeGet(`/v1/subscriptions/${session.subscription}`);
          if (subResult.status === 200) {
            await updateUserFromSubscription(subResult.body);
          }
        } else if (session.mode === "payment" && session.metadata?.docId) {
          // A customer just paid an invoice via the connected business's
          // destination charge — mark that specific document paid.
          await db.collection("docs").doc(session.metadata.docId).set(
            {
              status: "paid",
              paidAt: new Date().toISOString(),
              stripePaymentIntentId: session.payment_intent || null,
            },
            { merge: true }
          );
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await updateUserFromSubscription(stripeEvent.data.object);
        break;
      }
      case "account.updated": {
        await updateUserFromConnectAccount(stripeEvent.data.object);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    return { statusCode: 500, body: err.message };
  }

  return { statusCode: 200, body: "OK" };
};
