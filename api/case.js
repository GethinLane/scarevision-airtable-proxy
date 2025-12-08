// api/case.js
// Airtable proxy for Vercel – with CORS, returns full fields

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // --- CORS headers: allow your Squarespace site ---
  const allowedOrigins = [
    "https://www.scarevision.co.uk",
    "https://scarevision.co.uk"
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

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

    // ✅ Keep same shape as Airtable: records with full fields
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
