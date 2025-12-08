// api/case.js
// Airtable proxy for Vercel – CORS + 1-hour edge caching + full fields

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // --- CORS: allow your Squarespace site + preview domain ---
  const allowedOrigins = [
    "https://www.scarevision.co.uk",
    "https://scarevision.co.uk",
    "https://bluebird-tarantula-djcw.squarespace.com"
  ];

  if (
    allowedOrigins.includes(origin) ||
    (origin && origin.endsWith(".squarespace.com"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // --- Cache control ---
  // Cache at the Vercel edge for 1 hour (3600s),
  // and allow serving stale content for another 2 hours while it revalidates.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=5, stale-while-revalidate=5"
  );

  // --- Main logic: proxy to Airtable ---

  const table = req.query.table;
  if (!table) {
    return res.status(400).json({ error: "Missing 'table' query parameter" });
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    console.error("Missing Airtable env vars");
    return res.status(500).json({ error: "Server not configured correctly" });
  }

  const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    table
  )}`;

  try {
    const airtableResponse = await fetch(airtableUrl, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`
      }
    });

    if (!airtableResponse.ok) {
      const text = await airtableResponse.text();
      console.error("Airtable error:", airtableResponse.status, text);
      return res
        .status(airtableResponse.status)
        .json({ error: "Airtable request failed" });
    }

    const data = await airtableResponse.json();

    // Keep full fields so your existing frontend logic works unchanged
    const records = (data.records || []).map((record) => ({
      id: record.id,
      fields: record.fields
    }));

    return res.status(200).json({ records });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy error" });
  }
}
