const { getStore } = require("@netlify/blobs");
const telegramOrder = require("./telegram-order");

const orders = () => getStore("iconic-shop-orders");

const clean = (value, max = 500) => String(value ?? "").slice(0, max);

async function saveOrder(body) {
  const id = clean(body.id, 80).trim();
  const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  const total = Number(body.total);

  if (!id || !body.name || !/^[6-9]\d{9}$/.test(String(body.phone || "")) || !body.address || !body.paymentRef || String(body.paymentRef).trim().length < 6 || !Number.isFinite(total) || total <= 0 || !items.length) return;

  const store = orders();
  const existing = await store.get(`order-${id}`, { type: "json" });
  if (existing) return;

  const now = new Date().toISOString();
  const order = {
    id,
    name: clean(body.name, 80),
    phone: String(body.phone),
    address: clean(body.address, 500),
    paymentMethod: clean(body.paymentMethod || body.payment, 30),
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
    createdAt: now,
    updatedAt: now
  };

  await store.setJSON(`order-${id}`, order);
  const index = await store.get("index", { type: "json" }) || [];
  await store.setJSON("index", [id, ...index.filter(x => x !== id)].slice(0, 500));
}

async function updateStatus(id, status) {
  if (!id) return;
  const store = orders();
  const key = `order-${clean(id, 80)}`;
  const order = await store.get(key, { type: "json" });
  if (!order) return;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  await store.setJSON(key, order);
}

exports.handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  const isNewOrder = !body.message && !body.edited_message && !body.callback_query && body.id;
  const callback = body.callback_query;

  if (isNewOrder) {
    await saveOrder(body);
  }

  const result = await telegramOrder.handler(event);

  if (callback && result.statusCode >= 200 && result.statusCode < 300) {
    const parts = String(callback.data || "").split(":");
    const action = parts[0];
    const orderId = parts.slice(1).join(":");
    if (action === "approve") await updateStatus(orderId, "PAID");
    if (action === "reject") await updateStatus(orderId, "REJECTED");
  }

  return result;
};
