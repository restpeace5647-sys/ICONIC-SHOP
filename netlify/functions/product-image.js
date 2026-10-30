const { connectLambda, getStore } = require("@netlify/blobs");

exports.handler = async event => {
  connectLambda(event);
  const id = String(event.queryStringParameters?.id || "").trim();
  if (!/^[A-Za-z0-9._-]+\.(jpeg|png|webp)$/i.test(id)) {
    return { statusCode: 400, body: "Invalid image id" };
  }
  try {
    const data = await getStore("iconic-shop-products").get(id, { type: "arrayBuffer" });
    if (!data) return { statusCode: 404, body: "Image not found" };
    const ext = id.split(".").pop().toLowerCase();
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
      body: Buffer.from(data).toString("base64")
    };
  } catch {
    return { statusCode: 500, body: "Could not load image" };
  }
};
