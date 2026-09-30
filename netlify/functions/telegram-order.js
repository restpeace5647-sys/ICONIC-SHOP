
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "Method not allowed" })
    };
  }

  const token = process.env.8843674495:TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Telegram settings are missing"
      })
    };
  }

  let order;

  try {
    order = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid order" })
    };
  }

  const clean = (value, max = 300) =>
    String(value ?? "").replace(/[<>]/g, "").slice(0, max);

  const items = Array.isArray(order.items)
    ? order.items.slice(0, 30)
    : [];

  const total = Number(order.total);

  if (
    !order.id ||
    !order.name ||
    !/^[6-9]\d{9}$/.test(String(order.phone || "")) ||
    !order.address ||
    !order.paymentRef ||
    String(order.paymentRef).length < 6 ||
    !Number.isFinite(total) ||
    total <= 0 ||
    items.length === 0
  ) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Order details are incomplete"
      })
    };
  }

  const itemLines = items.map((item) => {
    const name = clean(item.name, 100);
    const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
    const price = Math.max(0, Number(item.price) || 0);

    return `• ${name} × ${qty} = ₹${(price * qty).toFixed(2)}`;
  }).join("\n");

  const message = [
    "💜 ICONIC SHOP — NEW ORDER",
    "",
    `Order ID: ${clean(order.id, 40)}`,
    "Status: ⏳ PAYMENT VERIFICATION PENDING",
    "",
    `Customer: ${clean(order.name, 80)}`,
    `Mobile: ${clean(order.phone, 15)}`,
    `Address: ${clean(order.address, 500)}`,
    "",
    "Items:",
    itemLines,
    "",
    `Cart total: ₹${total.toFixed(2)}`,
    `Payment app: ${clean(order.payment, 40)}`,
    `Customer-entered UPI reference: ${clean(order.paymentRef, 100)}`,
    "",
    "⚠️ Verify the actual payment in your UPI/bank app before shipping. The entered reference is not proof of payment."
  ].join("\n");

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message
        })
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Telegram message failed"
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
  } catch {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Telegram connection failed"
      })
    };
  }
};
          
