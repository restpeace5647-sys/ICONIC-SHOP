const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
const clean = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const db = () => getStore("iconic-shop-products");

async function readProducts() {
  const data = await db().get("catalog", { type: "json" });
  return Array.isArray(data) ? data : [];
}
function isAdmin(event) {
  const expected = process.env.ADMIN_PASSWORD;
  const provided = event.headers?.["x-admin-password"] || event.headers?.["X-Admin-Password"];
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected)), b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
exports.handler = async event => {
  if (event.httpMethod === "GET") {
    try { return reply(200, { ok: true, products: await readProducts() }); }
    catch { return reply(500, { ok: false, error: "Catalogue storage is unavailable. Check Netlify deployment and Blobs support." }); }
  }
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "Method not allowed" });
  if (!isAdmin(event)) return reply(401, { ok: false, error: "Admin password is incorrect or ADMIN_PASSWORD is not configured in Netlify." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "Invalid JSON." }); }
  try {
    const store = db(), products = await readProducts(), action = clean(body.action, 20);
    if (action === "delete") {
      const id = clean(body.id, 80);
      if (!products.some(p => p.id === id)) return reply(404, { ok: false, error: "Product not found." });
      const next = products.filter(p => p.id !== id);
      await store.setJSON("catalog", next);
      return reply(200, { ok: true, products: next });
    }
    if (action !== "save") return reply(400, { ok: false, error: "Unknown action." });
    const name = clean(body.name, 100), category = clean(body.category, 40), desc = clean(body.desc, 300);
    const price = Number(body.price), stock = Number(body.stock);
    if (!name || !category || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return reply(400, { ok: false, error: "Enter a name, category, valid price and whole-number stock." });
    let id = clean(body.id, 80), old = id ? products.find(p => p.id === id) : null;
    if (!id) id = crypto.randomUUID();
    let image = old?.image || "";
    if (body.imageData) {
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.imageData));
      if (!match) return reply(400, { ok: false, error: "Use a JPG, PNG or WebP photo." });
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > 1024 * 1024) return reply(413, { ok: false, error: "Compressed photo must be 1 MB or smaller." });
      const key = id + "." + match[1];
      await store.set(key, bytes, { metadata: { contentType: "image/" + match[1] } });
      image = "/.netlify/functions/product-image?id=" + encodeURIComponent(key);
    }
    const product = { id, name, category, desc, price, stock,
      sizes: Array.isArray(body.sizes) ? body.sizes.map(v => clean(v, 20)).filter(Boolean).slice(0, 20) : [],
      colours: Array.isArray(body.colours) ? body.colours.map(v => clean(v, 30)).filter(Boolean).slice(0, 20) : [],
      emoji: clean(body.emoji || "🛍️", 8), image, updatedAt: new Date().toISOString() };
    const next = old ? products.map(p => p.id === id ? product : p) : [product, ...products];
    await store.setJSON("catalog", next);
    return reply(200, { ok: true, products: next, product });
  } catch { return reply(500, { ok: false, error: "Could not save product. Check Netlify logs and storage configuration." }); }
};