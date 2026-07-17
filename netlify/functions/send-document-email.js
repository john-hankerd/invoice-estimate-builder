// netlify/functions/send-document-email.js
// Called from edit.html right after an invoice or estimate is marked
// "sent". Emails the customer a link to view it. Non-fatal if it fails —
// the document is already saved and the link works regardless; the
// business can always copy/share it manually.

const https = require("https");
const admin = require("firebase-admin");

// ─── CONFIG (Environment Variables in Netlify) ──────────────────────────────
// RESEND_API_KEY                — Resend API key
// RESEND_FROM_EMAIL              — optional, defaults to Resend's sandbox sender
// FIREBASE_SERVICE_ACCOUNT_KEY  — full JSON service account key, as a string
// ─────────────────────────────────────────────────────────────────────────────

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = admin.firestore();

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Invoicing <onboarding@resend.dev>";

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function sendEmail({ to, subject, html }) {
  const body = JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html });
  const options = {
    hostname: "api.resend.com",
    path: "/emails",
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  return httpsRequest(options, body);
}

function formatMoney(cents) {
  return ((cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { docId, viewUrl } = payload;
  if (!docId || !viewUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing docId or viewUrl" }) };
  }

  const snap = await db.collection("docs").doc(docId).get();
  if (!snap.exists) {
    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  }
  const data = snap.data();

  if (!data.customerEmail) {
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: "no customer email" }) };
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — skipping email, doc is still saved and viewable at", viewUrl);
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: "email not configured" }) };
  }

  const isEstimate = data.type === "estimate";
  const label = isEstimate ? "Estimate" : "Invoice";
  const businessName = data.business?.name || "Your business";

  try {
    const result = await sendEmail({
      to: data.customerEmail,
      subject: `${label} #${data.number} from ${businessName}`,
      html: `
        <p>Hi ${data.customerName || ""},</p>
        <p><strong>${businessName}</strong> sent you ${isEstimate ? "an estimate" : "an invoice"} for <strong>${formatMoney(data.totalCents)}</strong>.</p>
        <p><a href="${viewUrl}" style="display:inline-block;background:#2f7d5f;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:bold;">View ${label}</a></p>
        <p style="color:#888;font-size:13px;">Or copy this link: ${viewUrl}</p>
      `,
    });
    if (result.status >= 400) {
      console.error("Resend error:", result.body);
      return { statusCode: 200, body: JSON.stringify({ sent: false, reason: "resend error" }) };
    }
  } catch (err) {
    console.error("Email send failed:", err.message);
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: err.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ sent: true }) };
};
