const { connectLambda, getStore } = require("@netlify/blobs");

const typeFor = ext => ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

exports.handler = async event => {
  connectLambda(event);
  const id = String(event.queryStringParameters?.id || "").trim();
  if (!/^[A-Za-z0-9._-]+\.(jpeg|png|webp)$/i.test(id)) {
    return { statusCode: 400, body: "Invalid image id" };
  }
  try {
    const store = getStore("iconic-shop-products");
    const first = await store.get(id, { type: "arrayBuffer" });
    if (!first) return { statusCode: 404, body: "Image not found" };

    // New 3-photo products use: productId-1.ext, productId-2.ext, productId-3.ext.
    // Return a small SVG gallery so the existing storefront (which uses one <img>)
    // can display all three photos without changing the checkout/cart code.
    const match = /^(.*)-1\.(jpeg|png|webp)$/i.exec(id);
    if (match) {
      const base = match[1];
      const ext = match[2].toLowerCase();
      const photos = [];
      for (let i = 1; i <= 3; i++) {
        const key = `${base}-${i}.${ext}`;
        const data = i === 1 ? first : await store.get(key, { type: "arrayBuffer" });
        if (data) photos.push({ data: Buffer.from(data).toString("base64"), type: typeFor(ext) });
      }
      if (photos.length > 1) {
        const w = 100 / photos.length;
        const images = photos.map((p, i) => `<image href="data:${p.type};base64,${p.data}" x="${i * w}%" y="0" width="${w}%" height="100%" preserveAspectRatio="xMidYMid slice"/>`).join("");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${images}</svg>`;
        return {
          statusCode: 200,
          headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" },
          body: svg
        };
      }
    }

    const ext = id.split(".").pop().toLowerCase();
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: { "Content-Type": typeFor(ext), "Cache-Control": "public, max-age=31536000, immutable" },
      body: Buffer.from(first).toString("base64")
    };
  } catch {
    return { statusCode: 500, body: "Could not load image" };
  }
};
