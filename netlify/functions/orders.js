const { getStore } = require("@netlify/blobs");

const ordersStore = () => getStore("iconic-shop-orders");
const productsStore = () => getStore("iconic-shop-products");
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
const clean = (value, max = 500) => String(value ?? "").slice(0, max);

function isAdmin(event) {
  const expected = process.env.ADMIN_PASSWORD;
  const supplied = event.headers?.["x-admin-password"] || event.headers?.["X-Admin-Password"];
  return Boolean(expected && supplied && supplied === expected);
}

async function changeStock(items, direction) {
  const store = productsStore();
  const catalog = await store.get("catalog", { type: "json" }) || [];
  const next = catalog.map(p => ({ ...p }));
  for (const item of items) {
    const product = next.find(p => String(p.id) === String(item.id));
    if (!product) return { ok: false, error: `Product not found: ${item.name || item.id}` };
    const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
    const current = Math.max(0, Number(product.stock) || 0);
    if (direction === "decrease" && current < qty) return { ok: false, error: `Not enough stock for ${product.name}. Available: ${current}` };
  }
  for (const item of items) {
    const product = next.find(p => String(p.id) === String(item.id));
    const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
    product.stock = Math.max(0, (Number(product.stock) || 0) + (direction === "increase" ? qty : -qty));
    product.updatedAt = new Date().toISOString();
  }
  await store.setJSON("catalog", next);
  return { ok: true, products: next };
}

exports.handler = async (event) => {
  try {
    const orders = ordersStore();

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

    if (body.action === "status") {
      if (!isAdmin(event)) return reply(401, { ok: false, error: "Unauthorized" });
      const id = clean(body.id, 80).trim();
      const status = String(body.status || "").toUpperCase();
      if (!id || !["PENDING", "PAID", "REJECTED"].includes(status)) return reply(400, { ok: false, error: "Invalid order status" });
      const order = await orders.get(`order-${id}`, { type: "json" });
      if (!order) return reply(404, { ok: false, error: "Order not found" });
      if (order.status === status) return reply(200, { ok: true, order, unchanged: true });

      if (status === "PAID" && order.status !== "PAID") {
        const stock = await changeStock(order.items, "decrease");
        if (!stock.ok) return reply(409, { ok: false, error: stock.error });
      }
      if (status === "REJECTED" && order.status === "PAID") {
        await changeStock(order.items, "increase");
      }
      order.status = status;
      order.updatedAt = new Date().toISOString();
      await orders.setJSON(`order-${id}`, order);
      return reply(200, { ok: true, order });
    }

    const id = clean(body.id, 80).trim();
    const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
    const total = Number(body.total);
    if (!id || !body.name || !/^[6-9]\d{9}$/.test(String(body.phone || "")) || !body.address || !body.paymentRef || String(body.paymentRef).trim().length < 6 || !Number.isFinite(total) || total <= 0 || !items.length) {
      return reply(400, { ok: false, error: "Order details are incomplete" });
    }
    const existing = await orders.get(`order-${id}`, { type: "json" });
    if (existing) return reply(200, { ok: true, order: existing, duplicate: true });
    const order = {
      id, name: clean(body.name, 80), phone: String(body.phone), address: clean(body.address, 500),
      paymentMethod: clean(body.paymentMethod, 30), paymentRef: clean(body.paymentRef, 80).trim(), total,
      items: items.map(item => ({ id: clean(item.id, 100), name: clean(item.name, 120), qty: Math.max(1, Math.min(99, Number(item.qty) || 1)), price: Math.max(0, Number(item.price) || 0), size: clean(item.size, 40), colour: clean(item.colour, 40) })),
      status: "PENDING", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
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
