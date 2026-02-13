// api/case.js
// Airtable proxy for Vercel – CORS + caching + full fields
// ✅ Non-breaking addition: also returns CaseProfiles PatientImage when table is "Case N"

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  const allowedOrigins = [
    "https://www.scarevision.co.uk",
    "https://scarevision.co.uk",
    "https://bluebird-tarantula-djcw.squarespace.com",
    "https://www.scarevision.ai",
    "https://scarevision.ai",
    "https://viola-jaguar-b3bj.squarespace.com",
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

  if (req.method === "OPTIONS") return res.status(204).end();

  // NOTE: your comment says 1 hour but values are 5 seconds right now.
  // Keeping as-is to avoid changing caching behavior unexpectedly.
  res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=5");

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

  // Helper: pick best attachment URL
  function pickAttachmentUrl(att) {
    if (!att) return null;
    if (Array.isArray(att) && att.length) {
      const a = att[0];
      return a?.thumbnails?.large?.url || a?.thumbnails?.full?.url || a?.url || null;
    }
    if (typeof att === "object") {
      return att?.thumbnails?.large?.url || att?.thumbnails?.full?.url || att?.url || null;
    }
    return null;
  }

  // Helper: only attempt profile lookup for tables like "Case 123"
  function parseCaseNumberFromTableName(name) {
    const m = String(name || "").trim().match(/^case\s+(\d+)$/i);
    return m ? Number(m[1]) : null;
  }

  async function fetchCaseProfile(caseNumber) {
    // Adjust this if your CaseProfiles key field is named differently:
    const CASEPROFILES_KEY_FIELD = "CaseId"; // <- change to "CaseID" etc if needed

    const filterByFormula = `{${CASEPROFILES_KEY_FIELD}}=${caseNumber}`;
    const url =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent("CaseProfiles")}` +
      `?filterByFormula=${encodeURIComponent(filterByFormula)}` +
      `&maxRecords=1`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { ok: false, error: `CaseProfiles fetch failed (${r.status})`, raw: t.slice(0, 300) };
    }

    const j = await r.json();
    const rec = j?.records?.[0] || null;
    const fields = rec?.fields || {};
    const patientImageUrl = pickAttachmentUrl(fields.PatientImage);

    return {
      ok: true,
      found: !!rec,
      recordId: rec?.id || null,
      patientImageUrl: patientImageUrl || null,
    };
  }

  try {
    // 1) Fetch Case table records (existing behavior)
    const airtableResponse = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });

    if (!airtableResponse.ok) {
      const text = await airtableResponse.text();
      console.error("Airtable error:", airtableResponse.status, text);
      return res
        .status(airtableResponse.status)
        .json({ error: "Airtable request failed" });
    }

    const data = await airtableResponse.json();
    const records = (data.records || []).map((record) => ({
      id: record.id,
      fields: record.fields,
    }));

    // 2) Non-breaking add-on: also fetch CaseProfiles PatientImage
    let profile = { ok: true, found: false, recordId: null, patientImageUrl: null };

    const caseNumber = parseCaseNumberFromTableName(table);
    if (caseNumber) {
      // Only try if table is "Case N"
      profile = await fetchCaseProfile(caseNumber);
    }

    // ✅ Keep existing return shape; add `profile` as an extra key
    return res.status(200).json({ records, profile });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy error" });
  }
}
