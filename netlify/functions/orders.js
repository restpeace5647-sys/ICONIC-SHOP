const { getStore } = require("@netlify/blobs");

const store = () => getStore("iconic-shop-orders");

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

const reply = (statusCode, data) => ({
  statusCode,
  headers,
  body: JSON.stringify(data)
});

const clean = (value, max = 500) => String(value ?? "").slice(0, max);

function isAdmin(event) {
  const expected = process.env.ADMIN_PASSWORD;
  const supplied = event.headers?.["x-admin-password"] || event.headers?.["X-Admin-Password"];
  return Boolean(expected && supplied && supplied === expected);
}

exports.handler = async (event) => {
  try {
    const orders = store();

    if (event.httpMethod === "GET") {
      if (!isAdmin(event)) return reply(401, { ok: false, error: "Unauthorized" });
      const index = await orders.get("index", { type: "json" }) || [];
      const result = [];
      for (const id of index.slice(0, 200)) {
        const order = await orders.get(`order-${id}`, { type: "json" });
        if (order) result.push(order);
      }
      return reply(200, { ok: true, orders: result });
    }

    if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "Method not allowed" });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "Invalid JSON" }); }

    const id = clean(body.id, 80).trim();
    const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
    const total = Number(body.total);

    if (!id || !body.name || !/^[6-9]\d{9}$/.test(String(body.phone || "")) || !body.address || !body.paymentRef || String(body.paymentRef).trim().length < 6 || !Number.isFinite(total) || total <= 0 || !items.length) {
      return reply(400, { ok: false, error: "Order details are incomplete" });
    }

    const existing = await orders.get(`order-${id}`, { type: "json" });
    if (existing) return reply(200, { ok: true, order: existing, duplicate: true });

    const order = {
      id,
      name: clean(body.name, 80),
      phone: String(body.phone),
      address: clean(body.address, 500),
      paymentMethod: clean(body.paymentMethod, 30),
      paymentRef: clean(body.paymentRef, 80).trim(),
      total,
      items: items.map(item => ({
        id: clean(item.id, 100),
        name: clean(item.name, 120),
        qty: Math.max(1, Math.min(99, Number(item.qty) || 1)),
        price: Math.max(0, Number(item.price) || 0),
        size: clean(item.size, 40),
        colour: clean(item.colour, 40)
      })),
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await orders.setJSON(`order-${id}`, order);
    const index = await orders.get("index", { type: "json" }) || [];
    await orders.setJSON("index", [id, ...index.filter(x => x !== id)].slice(0, 500));

    return reply(200, { ok: true, order });
  } catch (error) {
    console.error(error);
    return reply(500, { ok: false, error: "Order storage failed" });
  }
};
