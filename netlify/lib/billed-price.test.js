const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { billedPriceFields } = require("./billed-price");

function loadFormatStoredPlanPrice() {
  const html = fs.readFileSync(path.join(__dirname, "../../app.html"), "utf8");
  const match = html.match(/function formatStoredPlanPrice\(profile\) \{[\s\S]*?\n\}/);
  if (!match) throw new Error("formatStoredPlanPrice not found in app.html");
  return new Function(`${match[0]}; return formatStoredPlanPrice;`)();
}

test("reads a modern monthly price", () => {
  const fields = billedPriceFields({
    items: {
      data: [{
        price: { unit_amount: 2000, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
      }],
    },
  });
  assert.deepEqual(fields, { planAmountCents: 2000, planInterval: "month" });
});

test("reads a modern annual price and a legacy plan object", () => {
  assert.deepEqual(
    billedPriceFields({
      items: {
        data: [{
          price: { unit_amount: 20000, currency: "usd", recurring: { interval: "year", interval_count: 1 } },
        }],
      },
    }),
    { planAmountCents: 20000, planInterval: "year" }
  );
  assert.deepEqual(
    billedPriceFields({
      items: { data: [{ plan: { amount: 1900, currency: "usd", interval: "month", interval_count: 1 } }] },
    }),
    { planAmountCents: 1900, planInterval: "month" }
  );
});

test("formats a stored subscription amount the way the settings screen shows it", () => {
  const formatStoredPlanPrice = loadFormatStoredPlanPrice();
  assert.equal(formatStoredPlanPrice({ planAmountCents: 2000, planInterval: "month" }), "$20/mo");
  assert.equal(formatStoredPlanPrice({ planAmountCents: 20000, planInterval: "year" }), "$200/yr");
  assert.equal(formatStoredPlanPrice({ planAmountCents: 1900, planInterval: "month" }), "$19/mo");
  assert.equal(formatStoredPlanPrice({ planAmountCents: 20900, planInterval: "year" }), "$209/yr");
  assert.equal(formatStoredPlanPrice({ planAmountCents: 2050, planInterval: "month" }), "$20.50/mo");
  assert.equal(formatStoredPlanPrice({ plan: "annual" }), null);
  assert.equal(formatStoredPlanPrice(null), null);
});

test("returns nothing when the price isn't a simple USD month or year amount", () => {
  assert.deepEqual(billedPriceFields({}), {});
  assert.deepEqual(billedPriceFields({ items: { data: [{ price: "price_123" }] } }), {});
  assert.deepEqual(
    billedPriceFields({
      items: { data: [{ price: { unit_amount: 2000, currency: "eur", recurring: { interval: "month", interval_count: 1 } } }] },
    }),
    {}
  );
  assert.deepEqual(
    billedPriceFields({
      items: { data: [{ price: { unit_amount: null, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] },
    }),
    {}
  );
  assert.deepEqual(
    billedPriceFields({
      items: { data: [{ price: { unit_amount: 6000, currency: "usd", recurring: { interval: "month", interval_count: 3 } } }] },
    }),
    {}
  );
});
