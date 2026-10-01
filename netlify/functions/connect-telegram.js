const crypto = require("crypto");

exports.handler = async event => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "Method not allowed" });
  const expected = process.env.ADMIN_PASSWORD;
  const provided = event.headers?.["x-admin-password"] || event.headers?.["X-Admin-Password"];
  if (!expected || !provided) return reply(401, { ok: false, error: "Admin password is not configured in Netlify." });
  const a = Buffer.from(String(expected)), b = Buffer.from(String(provided));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reply(401, { ok: false, error: "Admin password is incorrect." });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return reply(500, { ok: false, error: "TELEGRAM_BOT_TOKEN is missing in Netlify environment variables." });
  const siteUrl = process.env.URL || "https://endearing-cendol-4eaa85.netlify.app";
  const webhookUrl = siteUrl.replace(/\/$/, "") + "/.netlify/functions/telegram-order";
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "edited_message", "callback_query"] })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) return reply(502, { ok: false, error: data.description || "Telegram could not connect the webhook." });
    return reply(200, { ok: true, message: "Telegram connected to ICONIC SHOP product manager.", webhookUrl });
  } catch {
    return reply(502, { ok: false, error: "Could not connect to Telegram. Check Netlify function logs." });
  }
};
