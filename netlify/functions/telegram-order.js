
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  const reply = (statusCode, data) => ({
    statusCode,
    headers,
    body: JSON.stringify(data)
  });

  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "Method not allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return reply(500, {
      ok: false,
      error: "Telegram settings are missing"
    });
  }

  const clean = (value, max = 300) =>
    String(value ?? "")
      .replace(/[<>]/g, "")
      .slice(0, max);

  const telegram = async (method, data) => {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.description || "Telegram API failed");
    }

    return result;
  };

  try {
    let body;

    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return reply(400, { ok: false, error: "Invalid JSON" });
    }

    // Handle Telegram Approve / Reject button clicks
    if (body.callback_query) {
      const callback = body.callback_query;
      const message = callback.message;
      const actionData = String(callback.data || "").split(":");
      const action = actionData[0];

      if (
        !message ||
        String(message.chat.id) !== String(chatId) ||
        !["approve", "reject"].includes(action)
      ) {
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Unauthorized or invalid action."
        });

        return reply(200, { ok: true });
      }

      const oldText = message.text || "";
      const newStatus =
        action === "approve" ? "🟢 PAID" : "🔴 REJECTED";

      if (
        !oldText.includes("PAYMENT VERIFICATION PENDING")
      ) {
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "This order has already been processed."
        });

        return reply(200, { ok: true });
      }

      const updatedText = oldText.replace(
        "🟡 PAYMENT VERIFICATION PENDING",
        newStatus
      );

      await telegram("editMessageText", {
        chat_id: message.chat.id,
        message_id: message.message_id,
        text:
          updatedText +
          "\n\nAdmin action: " +
          (action === "approve"
            ? "Payment marked PAID."
            : "Payment marked REJECTED."),
        reply_markup: { inline_keyboard: [] }
      });

      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text:
          action === "approve"
            ? "Order marked PAID."
            : "Order marked REJECTED."
      });

      return reply(200, { ok: true });
    }

    // Handle new orders from ICONIC SHOP
    const order = body;

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
      String(order.paymentRef).trim().length < 6 ||
      !Number.isFinite(total) ||
      total <= 0 ||
      items.length === 0
    ) {
      return reply(400, {
        ok: false,
        error: "Order details are incomplete"
      });
    }

    const itemLines = items.map((item) => {
      const name = clean(item.name, 100);
      const qty = Math.max(
        1,
        Math.min(99, Number(item.qty) || 1)
      );
      const price = Math.max(0, Number(item.price) || 0);

      return `${name} × ${qty} = ₹${(price * qty).toFixed(2)}`;
    }).join("\n");

    const message = [
      "💜 ICONIC SHOP — NEW ORDER",
      "",
      `Order ID: ${clean(order.id, 40)}`,
      "Status: 🟡 PAYMENT VERIFICATION PENDING",
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
      "⚠️ Verify the actual payment in your UPI app before approving."
    ].join("\n");

    const orderId = clean(order.id, 40);

    await telegram("sendMessage", {
      chat_id: chatId,
      text: message,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ APPROVE / MARK PAID",
              callback_data: `approve:${orderId}`
            },
            {
              text: "❌ REJECT",
              callback_data: `reject:${orderId}`
            }
          ]
        ]
      }
    });

    return reply(200, { ok: true });
  } catch (error) {
    return reply(502, {
      ok: false,
      error: "Telegram request failed"
    });
  }
};
