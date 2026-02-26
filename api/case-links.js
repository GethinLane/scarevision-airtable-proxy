// api/case-links.js
export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // --- CORS ---
  const allowedOrigins = [
    "https://www.scarevision.co.uk",
    "https://scarevision.co.uk",
    "https://bluebird-tarantula-djcw.squarespace.com",
    "https://www.scarevision.ai",
    "https://viola-jaguar-b3bj.squarespace.com",
    "https://www.viola-jaguar-b3bj.squarespace.com",
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

  const caseId = String(req.query.case || "").trim();
  if (!caseId) return res.status(400).json({ error: "Missing ?case=" });

  // ✅ Use EXISTING env var
  const AIRTABLE_API_KEY = process.env.AIRTABLE_CASELIST_API_KEY;

  const AIRTABLE_BASE_ID = "appcfY32cRVRuUJ9i";
  const AIRTABLE_TABLE_ID = "tbl0zASOWTNNXGayL"; // Cases List table id

  if (!AIRTABLE_API_KEY) {
    return res.status(500).json({ error: "Missing AIRTABLE_CASELIST_API_KEY env var" });
  }

  // Find single record by Case ID
  const formula = encodeURIComponent(`{Case ID} = "${caseId}"`);

  // Only fetch what we need
  const url =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}` +
    `?maxRecords=1&filterByFormula=${formula}` +
    `&fields[]=Link&fields[]=Video%20Link&fields[]=Case%20ID`;

  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: "Airtable request failed", detail: text });
    }

    const data = await r.json();
    const rec = data.records?.[0];
    const fields = rec?.fields || {};

    const prefix = "https://www.scarevision.co.uk/";

    const normalize = (v) => {
      if (!v) return null;
      const s = String(v).trim();
      if (!s) return null;
      if (/^https?:\/\//i.test(s)) return s;
      return prefix.replace(/\/$/, "") + "/" + s.replace(/^\//, "");
    };

    return res.status(200).json({
      writtenUrl: normalize(fields["Link"]),
      videoUrl: normalize(fields["Video Link"]),
    });
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: String(err?.message || err) });
  }
}
