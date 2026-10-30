const { handler: telegramOrderHandler } = require("./telegram-order");
const { handler: ordersHandler } = require("./orders");

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "POST") {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch {}

      const callback = body.callback_query;
      const actionData = String(callback?.data || "").split(":");
      const action = actionData[0];

      if (callback && ["approve", "reject"].includes(action)) {
        const messageText = String(callback.message?.text || "");
        const orderId = actionData.slice(1).join(":") ||
          (messageText.match(/Order ID:\s*([^\n]+)/i)?.[1] || "").trim();

        if (orderId && process.env.ADMIN_PASSWORD) {
          const statusEvent = {
            ...event,
            httpMethod: "POST",
            headers: {
              ...(event.headers || {}),
              "x-admin-password": process.env.ADMIN_PASSWORD
            },
            body: JSON.stringify({
              action: "status",
              id: orderId,
              status: action === "approve" ? "PAID" : "REJECTED"
            })
          };
          const result = await ordersHandler(statusEvent);
          if (result.statusCode >= 400) {
            console.error("Telegram order status sync failed:", result.body);
          }
        }
      }
    }
  } catch (error) {
    console.error("Telegram status sync error:", error);
  }

  return telegramOrderHandler(event);
};
