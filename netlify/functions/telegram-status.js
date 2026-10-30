const { getStore } = require("@netlify/blobs");

const ordersStore = () => getStore("iconic-shop-orders");
const productsStore = () => getStore("iconic-shop-products");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });

  try {
    if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "Method not allowed" });
    const secret = process.env.TELEGRAM_BOT_TOKEN;
    const supplied = event.headers?.["x-telegram-secret"] || event.headers?.["X-Telegram-Secret"];
    if (!secret || supplied !== secret) return reply(401, { ok: false, error: "Unauthorized" });

    const body = JSON.parse(event.body || "{}");
    const id = String(body.id || "").trim();
    const status = String(body.status || "").toUpperCase();
    if (!id || !["PAID", "REJECTED", "PENDING"].includes(status)) return reply(400, { ok: false, error: "Invalid status" });

    const orders = ordersStore();
    const order = await orders.get(`order-${id}`, { type: "json" });
    if (!order) return reply(404, { ok: false, error: "Order not found" });
    if (order.status === status) return reply(200, { ok: true, order, unchanged: true });

    const products = productsStore();
    const catalog = await products.get("catalog", { type: "json" }) || [];
    const next = catalog.map(p => ({ ...p }));

    if (status === "PAID" && order.status !== "PAID") {
      for (const item of order.items || []) {
        const p = next.find(x => String(x.id) === String(item.id));
        const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
        if (!p) return reply(409, { ok: false, error: `Product not found: ${item.name || item.id}` });
        if (Math.max(0, Number(p.stock) || 0) < qty) return reply(409, { ok: false, error: `Not enough stock for ${p.name}. Available: ${p.stock}` });
      }
      for (const item of order.items || []) {
        const p = next.find(x => String(x.id) === String(item.id));
        const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
        p.stock = Math.max(0, (Number(p.stock) || 0) - qty);
        p.updatedAt = new Date().toISOString();
      }
      await products.setJSON("catalog", next);
    }

    if (status === "REJECTED" && order.status === "PAID") {
      for (const item of order.items || []) {
        const p = next.find(x => String(x.id) === String(item.id));
        if (p) {
          const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
          p.stock = Math.max(0, (Number(p.stock) || 0) + qty);
          p.updatedAt = new Date().toISOString();
        }
      }
      await products.setJSON("catalog", next);
    }

    order.status = status;
    order.updatedAt = new Date().toISOString();
    await orders.setJSON(`order-${id}`, order);
    return reply(200, { ok: true, order });
  } catch (error) {
    console.error(error);
    return reply(500, { ok: false, error: "Status update failed" });
  }
};
