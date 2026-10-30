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

    const match = /^(.*)-1\.(jpeg|png|webp)$/i.exec(id);
    if (match) {
      const base = match[1];
      const photos = [];
      for (let i = 1; i <= 3; i++) {
        let data = null;
        let ext = null;
        for (const candidate of ["jpeg", "jpg", "png", "webp"]) {
          if (candidate === "jpg") continue;
          const key = `${base}-${i}.${candidate}`;
          data = i === 1 && candidate === match[2].toLowerCase() ? first : await store.get(key, { type: "arrayBuffer" });
          if (data) { ext = candidate; break; }
        }
        if (data) photos.push({ data: Buffer.from(data).toString("base64"), type: typeFor(ext) });
      }
      if (photos.length > 1) {
        const w = 100 / photos.length;
        const images = photos.map((p, i) => `<image href="data:${p.type};base64,${p.data}" x="${i * w}%" y="0" width="${w}%" height="100%" preserveAspectRatio="xMidYMid slice"/>`).join("");
        return {
          statusCode: 200,
          headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
          body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${images}</svg>`
        };
      }
    }

    const ext = id.split(".").pop().toLowerCase();
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: { "Content-Type": typeFor(ext), "Cache-Control": "no-store" },
      body: Buffer.from(first).toString("base64")
    };
  } catch {
    return { statusCode: 500, body: "Could not load image" };
  }
};
