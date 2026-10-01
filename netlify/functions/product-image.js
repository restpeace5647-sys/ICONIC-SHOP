const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const key = String(event.queryStringParameters?.id || "");
  if (!/^[a-f0-9-]{20,80}\\.jpeg$/i.test(key)) {
    return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: "Invalid image id" };
  }
  try {
    const blob = await getStore("iconic-shop-products").get(key, { type: "arrayBuffer" });
    if (!blob) return { statusCode: 404, headers: { "Cache-Control": "no-store" }, body: "Image not found" };
    return {
      statusCode: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
      isBase64Encoded: true,
      body: Buffer.from(blob).toString("base64")
    };
  } catch {
    return { statusCode: 500, headers: { "Cache-Control": "no-store" }, body: "Image unavailable" };
  }
};
