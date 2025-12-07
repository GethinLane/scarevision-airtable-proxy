// api/case.js
// Vercel serverless function: proxy to Airtable, no keys in frontend

const allowedOrigins = [
  "https://www.scarevision.co.uk",
  "https://scarevision.co.uk"
];

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // Only allow requests from your Squarespace domain
  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  const table = req.query.table;
  if (!table) {
    return res.status(400).json({ error: "Missing 'table' query parameter" });
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
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

    // Return only the fields you actually need
    const safeRecords = (data.records || []).map((record) => ({
      id: record.id,
      fields: {
        Name: record.fields["Name"],
        "Video Link": record.fields["Video Link"],
        "AI Link": record.fields["AI Link"],
        Link: record.fields["Link"],
        "Link-nt": record.fields["Link-nt"]
      }
    }));

    return res.status(200).json({ records: safeRecords });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy error" });
  }
}
