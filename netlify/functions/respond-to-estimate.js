// netlify/functions/respond-to-estimate.js
// Called from the public view.html page when a customer approves or
// declines an estimate. Runs server-side with the Admin SDK because
// customers never sign in — Firestore security rules can't let an anonymous
// visitor write directly, so this function is the one narrow, validated
// door for that specific action.

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = admin.firestore();

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

  const { docId, response } = payload;
  if (!docId || !["approved", "declined"].includes(response)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing docId or invalid response" }) };
  }

  const ref = db.collection("docs").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: "Not found" }) };
  }
  const data = snap.data();
  if (data.type !== "estimate" || data.status !== "sent") {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "This estimate can't be responded to right now" }) };
  }

  await ref.update({ status: response, respondedAt: new Date().toISOString() });

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
};
