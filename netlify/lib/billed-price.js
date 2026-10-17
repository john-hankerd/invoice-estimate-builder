// Price fields copied from a Stripe subscription onto the Firestore user doc.
// Returns {} when the subscription isn't a simple USD monthly or yearly price,
// so callers can merge the result without wiping a previously stored amount.

function billedPriceFields(sub) {
  const items = sub && sub.items && Array.isArray(sub.items.data) ? sub.items.data : [];
  const item = items[0];
  if (!item) return {};

  const price = item.price && typeof item.price === "object" ? item.price : null;
  const legacy = item.plan && typeof item.plan === "object" ? item.plan : null;

  const cents = price && typeof price.unit_amount === "number"
    ? price.unit_amount
    : legacy && typeof legacy.amount === "number"
      ? legacy.amount
      : null;
  const interval = price && price.recurring && price.recurring.interval
    ? price.recurring.interval
    : legacy && legacy.interval
      ? legacy.interval
      : null;
  const intervalCount = (price && price.recurring && price.recurring.interval_count)
    || (legacy && legacy.interval_count)
    || 1;
  const currency = (price && price.currency) || (legacy && legacy.currency) || "usd";

  if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) return {};
  if (interval !== "month" && interval !== "year") return {};
  if (intervalCount !== 1 || currency !== "usd") return {};

  return { planAmountCents: cents, planInterval: interval };
}

module.exports = { billedPriceFields };
