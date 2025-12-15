// api/cases-list-data.js
export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // --- CORS ---
  const allowedOrigins = [
    "https://www.scarevision.co.uk",
    "https://scarevision.co.uk",
    "https://bluebird-tarantula-djcw.squarespace.com",
  ];

  if (allowedOrigins.includes(origin) || (origin && origin.endsWith(".squarespace.com"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ✅ Edge cache: 1 hour fresh, 2 hours stale while revalidating
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");

  // ---- Your CASE LIST Airtable (index) ----
  // Base: appcfY32cRVRuUJ9i (you confirmed)
  // Table: tbl0zASOWTNNXGayL (you confirmed)
  //
  // Put only the API key in env vars.
  const AIRTABLE_API_KEY = process.env.AIRTABLE_CASELIST_API_KEY;
  const AIRTABLE_BASE_ID = "appcfY32cRVRuUJ9i";
  const AIRTABLE_TABLE_ID = "tbl0zASOWTNNXGayL";

  if (!AIRTABLE_API_KEY) {
    return res.status(500).json({ error: "Missing AIRTABLE_CASELIST_API_KEY env var" });
  }

  // Only fields your frontend uses (smaller payload)
  const FIELDS = [
    "Themes",
    "Video Link",
    "Clinical Topics",
    "Domain",
    "Name",
    "Presenting Complaint",
    "Link",
    "Link-nt",
    "Difficulty",
    "Case ID",
    "Case Number",
    "Case",
  ];

  const pageSize = 100;
  let offset = null;
  const all = [];

  try {
    do {
      const params = new URLSearchParams();
      params.set("pageSize", String(pageSize));
      for (const f of FIELDS) params.append("fields[]", f);
      if (offset) params.set("offset", offset);

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?${params.toString()}`;

      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });

      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ error: "Airtable request failed", detail: text });
      }

      const data = await r.json();
      const records = Array.isArray(data.records) ? data.records : [];
      for (const rec of records) {
        all.push({ id: rec.id, fields: rec.fields || {} });
      }

      offset = data.offset || null;
    } while (offset);

    return res.status(200).json({ records: all });
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: String(err?.message || err) });
  }
}
