
const { getStore } = require("@netlify/blobs");

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


    // Telegram owner product-management chat flow
    if (body.message || body.edited_message) {
      const msg = body.message || body.edited_message;
      const chat = msg.chat;
      if (!chat || String(chat.id) !== String(chatId)) return reply(200, { ok: true });
      const store = getStore("iconic-shop-products");
      const stateKey = "telegram-product-session-" + String(chat.id);
      const text = String(msg.text || msg.caption || "").trim();
      const send = async (messageText) => telegram("sendMessage", { chat_id: chat.id, text: messageText });
      if (text === "/cancel") {
        await store.delete(stateKey);
        await send("❎ Product upload cancelled. Start again with /addproduct.");
        return reply(200, { ok: true });
      }
      if (text === "/start" || text === "/help") {
        await send("💜 ICONIC SHOP product manager\n\n/addproduct — upload a product photo and details\n/products — view saved products\n/cancel — cancel current upload");
        return reply(200, { ok: true });
      }
      if (text === "/products") {
        const catalog = await store.get("catalog", { type: "json" }) || [];
        const lines = catalog.slice(0, 40).map((p, i) => (i + 1) + ". " + p.name + " — ₹" + p.price + " | Stock: " + p.stock);
        await send(lines.length ? "📦 ICONIC SHOP products\n\n" + lines.join("\n") : "No products saved yet. Send /addproduct to add your first product.");
        return reply(200, { ok: true });
      }
      if (text === "/addproduct") {
        await store.setJSON(stateKey, { step: "photo", draft: {} });
        await send("📸 Send the product photo now.\n\nTip: send a clear photo. Send /cancel anytime to stop.");
        return reply(200, { ok: true });
      }
      let session = await store.get(stateKey, { type: "json" });
      if (!session) return reply(200, { ok: true });
      const draft = session.draft || {};
      if (session.step === "photo") {
        const photos = Array.isArray(msg.photo) ? msg.photo : [];
        if (!photos.length) {
          await send("Please send the product photo using Telegram's 📎 attachment button. Or send /cancel.");
          return reply(200, { ok: true });
        }
        const photo = photos[photos.length - 1];
        const fileInfo = await telegram("getFile", { file_id: photo.file_id });
        const fileResponse = await fetch("https://api.telegram.org/file/bot" + token + "/" + fileInfo.result.file_path);
        if (!fileResponse.ok) throw new Error("Telegram photo download failed");
        const bytes = Buffer.from(await fileResponse.arrayBuffer());
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
          await send("Photo is too large. Please send a smaller image (under 8 MB).");
          return reply(200, { ok: true });
        }
        const id = crypto.randomUUID();
        const imageKey = id + ".jpeg";
        await store.set(imageKey, bytes, { metadata: { contentType: "image/jpeg" } });
        draft.id = id;
        draft.image = "/.netlify/functions/product-image?id=" + encodeURIComponent(imageKey);
        session = { step: "name", draft };
        await store.setJSON(stateKey, session);
        await send("✅ Photo received!\n\n1/6 — Product ka naam kya hai?");
        return reply(200, { ok: true });
      }
      if (!text) {
        await send("Please reply with text for this step, or send /cancel.");
        return reply(200, { ok: true });
      }
      if (session.step === "name") {
        if (text.length > 100) { await send("Name 100 characters se chhota rakho. Dobara bhejo."); return reply(200, { ok: true }); }
        draft.name = text;
        session.step = "category";
        await send("2/6 — Category batao (Fashion, Beauty, Electronics, Home, Shoes, Accessories ya Other).");
      } else if (session.step === "category") {
        draft.category = text.slice(0, 40);
        session.step = "price";
        await send("3/6 — Price kitni hai? Sirf number bhejo, jaise 499.");
      } else if (session.step === "price") {
        const price = Number(text.replace(/[₹,\\s]/g, ""));
        if (!Number.isFinite(price) || price < 0 || price > 10000000) { await send("Valid price bhejo, jaise 499."); return reply(200, { ok: true }); }
        draft.price = price;
        session.step = "sizes";
        await send("4/6 — Sizes bhejo, comma se alag (S, M, L, XL). Agar size nahi hai to Skip bhejo.");
      } else if (session.step === "sizes") {
        draft.sizes = /^skip$/i.test(text) ? [] : text.split(",").map(v => v.trim()).filter(Boolean).slice(0, 20);
        session.step = "colours";
        await send("5/6 — Colours bhejo, comma se alag (Purple, White). Nahi hain to Skip bhejo.");
      } else if (session.step === "colours") {
        draft.colours = /^skip$/i.test(text) ? [] : text.split(",").map(v => v.trim()).filter(Boolean).slice(0, 20);
        session.step = "stock";
        await send("6/6 — Kitne pieces stock mein hain? Sirf whole number bhejo, jaise 10.");
      } else if (session.step === "stock") {
        const stock = Number(text);
        if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) { await send("Stock valid whole number mein bhejo, jaise 10."); return reply(200, { ok: true }); }
        const catalog = await store.get("catalog", { type: "json" }) || [];
        const product = {
          id: draft.id, name: draft.name, category: draft.category, desc: "",
          price: draft.price, stock: stock, sizes: draft.sizes || [], colours: draft.colours || [],
          emoji: "🛍️", image: draft.image, updatedAt: new Date().toISOString()
        };
        await store.setJSON("catalog", [product, ...catalog.filter(p => p.id !== product.id)]);
        await store.delete(stateKey);
        await send("🎉 Product website catalogue mein save ho gaya!\n\n📦 " + product.name + "\n💰 ₹" + product.price + "\n🏷️ " + product.category + "\n📏 Sizes: " + (product.sizes.join(", ") || "N/A") + "\n🎨 Colours: " + (product.colours.join(", ") || "N/A") + "\n📊 Stock: " + product.stock + "\n\nWebsite refresh karke check karo. Naya product add karne ke liye /addproduct bhejo.");
        return reply(200, { ok: true });
      }
      await store.setJSON(stateKey, session);
      return reply(200, { ok: true });
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
