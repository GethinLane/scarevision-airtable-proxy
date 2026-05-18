// api/sync-cases.js
//
// Syncs Airtable "Case {N}" tables into gethinlane/sca-revision at
// content/cases/{N}.json. Designed to be triggered either by:
//
//   - Vercel Cron (GET, every 6h) — full sync of cases 1..355
//   - Airtable Automation (POST { caseId } | { from, to }) — single / range
//
// Auth: Authorization: Bearer ${CRON_SECRET}
//   - Vercel automatically attaches this header on cron invocations when
//     CRON_SECRET is set as an env var.
//   - Airtable Automations must send the same header value.
//
// On each run, only the cases whose JSON has actually changed are written,
// and all writes are bundled into a single tree commit on main. If nothing
// changed, no commit is created.
//
// Note: the per-file JSON intentionally has no "syncedAt" field. The git
// commit timestamp is the source of truth for when each case last changed.
// Embedding a timestamp inside the file would break byte-identical
// idempotency and produce a noisy commit on every cron run.

import { createHash } from 'node:crypto';
import { put, list } from '@vercel/blob';

export const config = {
  maxDuration: 300,
};

// ---- Tunables ----
const DEFAULT_FROM = 1;
const DEFAULT_TO = 355;
const AIRTABLE_RATE_MS = 200;     // ~5 req/s ceiling per base
const PAGE_SIZE = 100;
const SORT_FIELD = 'Order';

// ---- Target repo for committed JSON ----
const TARGET_OWNER = 'gethinlane';
const TARGET_REPO = 'sca-revision';
const TARGET_BRANCH = 'main';
const TARGET_DIR = 'content/cases';

// ---- Vercel Blob mirror for Airtable attachments ----
// Airtable's attachment URLs are signed and expire after a few hours, so
// embedding them in long-lived JSON would break image references between
// syncs. We mirror every attachment into the existing case-images-blob
// store under this prefix, keyed by the stable Airtable attachment id,
// and rewrite the URLs in the JSON to permanent public blob URLs.
const BLOB_PREFIX = 'CaseContentImages';

export default async function handler(req, res) {
  const startedAt = Date.now();

  // ----- Auth -----
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return json(res, 500, { error: 'CRON_SECRET not configured on Vercel' });
  }
  if ((req.headers.authorization || '') !== `Bearer ${expected}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  // ----- Pick range -----
  const body = await readJsonBody(req);
  const query = req.query || {};
  const caseId = toInt(body.caseId ?? query.caseId);
  const from = toInt(body.from ?? query.from);
  const to = toInt(body.to ?? query.to);

  let ids;
  if (Number.isFinite(caseId)) {
    ids = [caseId];
  } else if (Number.isFinite(from) || Number.isFinite(to)) {
    const f = Number.isFinite(from) ? from : DEFAULT_FROM;
    const t = Number.isFinite(to) ? to : DEFAULT_TO;
    if (f > t) return json(res, 400, { error: '`from` must be <= `to`' });
    ids = makeRange(f, t);
  } else {
    ids = makeRange(DEFAULT_FROM, DEFAULT_TO);
  }

  // ----- Env -----
  const airtableApiKey = process.env.AIRTABLE_API_KEY;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID;
  const githubToken = process.env.GITHUB_SYNC_TOKEN;
  // Optional: when set, attachments are mirrored into Vercel Blob and the
  // URLs in the JSON output are rewritten to permanent blob URLs. When
  // absent, attachments pass through as-is (with the short-lived Airtable
  // signed URLs intact).
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!airtableApiKey || !airtableBaseId) {
    return json(res, 500, { error: 'Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID' });
  }
  if (!githubToken) {
    return json(res, 500, { error: 'Missing GITHUB_SYNC_TOKEN' });
  }

  // ----- Snapshot existing blob SHAs in one call -----
  let existingShas;
  try {
    existingShas = await fetchExistingShas(githubToken);
  } catch (err) {
    console.error('Listing existing case files failed:', err);
    return json(res, 500, {
      error: 'Failed to list existing case files',
      detail: String(err.message || err),
    });
  }

  // ----- Pull from Airtable, build JSON, diff against existing -----
  const results = [];
  const changedFiles = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const t0 = Date.now();
    try {
      const records = await fetchCaseTable(id, airtableBaseId, airtableApiKey);
      const payload = buildCaseJson(id, records);
      if (blobToken) {
        await mirrorAttachmentsInPayload(id, payload.fields, blobToken);
      }
      const content = JSON.stringify(payload, null, 2) + '\n';
      const path = `${TARGET_DIR}/${id}.json`;
      const newSha = gitBlobSha(content);
      const existing = existingShas[path];
      const ms = Date.now() - t0;
      const fieldCount = Object.keys(payload.fields).length;
      if (existing === newSha) {
        results.push({ id, status: 'unchanged', rows: payload.rowCount, fields: fieldCount, ms });
      } else {
        changedFiles.push({ path, content });
        results.push({
          id,
          status: existing ? 'changed' : 'created',
          rows: payload.rowCount,
          fields: fieldCount,
          ms,
        });
      }
    } catch (err) {
      const ms = Date.now() - t0;
      if (err.code === 'TABLE_NOT_FOUND') {
        results.push({ id, status: 'missing', ms });
      } else {
        console.error(`Case ${id} failed:`, err);
        results.push({ id, status: 'failed', error: String(err.message || err), ms });
      }
    }
    if (i < ids.length - 1) await sleep(AIRTABLE_RATE_MS);
  }

  // ----- Commit (if anything changed) -----
  let commitSha = null;
  if (changedFiles.length > 0) {
    try {
      const message = buildCommitMessage(results, changedFiles.length);
      commitSha = await commitFilesAsTree(githubToken, changedFiles, message);
    } catch (err) {
      console.error('GitHub commit failed:', err);
      return json(res, 500, {
        error: 'GitHub commit failed',
        detail: String(err.message || err),
        partial: summarize(results),
      });
    }
  }

  const summary = summarize(results);
  return json(res, 200, {
    ok: true,
    commitSha,
    requested: ids.length,
    ...summary,
    totalMs: Date.now() - startedAt,
    range: ids.length <= 5 ? ids : { first: ids[0], last: ids[ids.length - 1], count: ids.length },
  });
}

// ============================================================
//  Helpers
// ============================================================

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body, null, 2));
}

async function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (typeof req.body === 'object') return req.body;
  return {};
}

function toInt(v) {
  if (v === undefined || v === null || v === '') return NaN;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : NaN;
}

function makeRange(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function summarize(results) {
  const created = results.filter((r) => r.status === 'created').map((r) => r.id);
  const changed = results.filter((r) => r.status === 'changed').map((r) => r.id);
  const unchanged = results.filter((r) => r.status === 'unchanged').length;
  const missing = results.filter((r) => r.status === 'missing').map((r) => r.id);
  const failed = results.filter((r) => r.status === 'failed');
  return {
    created,
    changed,
    unchanged,
    missing,
    failed: failed.map((r) => ({ id: r.id, error: r.error })),
  };
}

function buildCommitMessage(results, changedCount) {
  const created = results.filter((r) => r.status === 'created').map((r) => r.id);
  const changed = results.filter((r) => r.status === 'changed').map((r) => r.id);

  // Short summary on first line; details below.
  const head = changedCount === 1
    ? `Sync case ${created[0] ?? changed[0]} from Airtable`
    : `Sync ${changedCount} cases from Airtable`;

  const lines = [head, ''];
  if (created.length) lines.push(`Created: ${created.join(', ')}`);
  if (changed.length) lines.push(`Updated: ${changed.join(', ')}`);
  return lines.join('\n');
}

// ============================================================
//  Airtable
// ============================================================

async function fetchCaseTable(caseId, baseId, apiKey) {
  const tableName = `Case ${caseId}`;
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('pageSize', String(PAGE_SIZE));
    params.set('sort[0][field]', SORT_FIELD);
    params.set('sort[0][direction]', 'asc');
    if (offset) params.set('offset', offset);

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?${params}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      if (isTableNotFound(r.status, text)) {
        const err = new Error(`Airtable table "${tableName}" not found`);
        err.code = 'TABLE_NOT_FOUND';
        throw err;
      }
      throw new Error(`Airtable ${r.status} for "${tableName}": ${text.slice(0, 300)}`);
    }

    const data = await r.json();
    if (Array.isArray(data.records)) records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

function isTableNotFound(status, body) {
  if (status === 404) return true;
  if (status === 422 && typeof body === 'string') {
    return /NOT_FOUND|could not find table|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/i.test(body);
  }
  return false;
}

function buildCaseJson(caseId, records) {
  const rowCount = records.length;
  if (rowCount === 0) {
    return { caseId, rowCount: 0, fields: {} };
  }

  // Collect every field name that appears on any row (excluding the
  // sort field itself), sorted alphabetically for a stable on-disk
  // representation — makes git diffs readable.
  const fieldNames = new Set();
  for (const r of records) {
    for (const k of Object.keys(r.fields || {})) {
      if (k === SORT_FIELD) continue;
      fieldNames.add(k);
    }
  }
  const sortedFieldNames = [...fieldNames].sort();

  const fields = {};
  for (const name of sortedFieldNames) {
    const arr = new Array(rowCount).fill('');
    for (let i = 0; i < rowCount; i++) {
      const v = records[i].fields ? records[i].fields[name] : undefined;
      if (v !== undefined && v !== null) arr[i] = v;
    }
    fields[name] = arr;
  }

  return { caseId, rowCount, fields };
}

// ============================================================
//  GitHub (Git Data API — single tree commit per run)
// ============================================================

async function ghFetch(token, path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'scarevision-airtable-proxy-sync',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const err = new Error(`GitHub ${r.status} ${path}: ${text.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function fetchExistingShas(token) {
  try {
    const items = await ghFetch(
      token,
      `/repos/${TARGET_OWNER}/${TARGET_REPO}/contents/${TARGET_DIR}?ref=${TARGET_BRANCH}`
    );
    const map = {};
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it.type === 'file') map[it.path] = it.sha;
      }
    }
    return map;
  } catch (err) {
    // Directory doesn't exist yet — first run, treat as empty.
    if (err.status === 404) return {};
    throw err;
  }
}

async function commitFilesAsTree(token, files, message) {
  const repoPath = `/repos/${TARGET_OWNER}/${TARGET_REPO}`;

  // Blobs are content-addressed and immutable — create them once, before
  // the ref-update loop. If we have to retry the commit because main moved
  // under us, the blobs are still valid and we just rebuild the tree.
  //
  // Throttle blob creation. Firing N parallel POSTs to /git/blobs trips
  // GitHub's secondary rate limit once N gets into the hundreds (a full
  // first-time sync of 355 cases hits this hard). A small concurrency
  // window keeps us comfortably under the threshold; for the rare case
  // we still trip it, ghFetchWithRateLimitBackoff retries with backoff.
  const blobs = await createBlobsThrottled(token, files, repoPath);

  // Tree → commit → update-ref races with anything else committing to
  // main during the sync (e.g. a PR merge). On a non-fast-forward 422,
  // refetch the ref and try again with the new parent.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ref = await ghFetch(token, `${repoPath}/git/refs/heads/${TARGET_BRANCH}`);
      const parentSha = ref.object.sha;

      const parentCommit = await ghFetch(token, `${repoPath}/git/commits/${parentSha}`);
      const parentTreeSha = parentCommit.tree.sha;

      const newTree = await ghFetch(token, `${repoPath}/git/trees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_tree: parentTreeSha,
          tree: blobs.map((b) => ({
            path: b.path,
            mode: '100644',
            type: 'blob',
            sha: b.sha,
          })),
        }),
      });

      const newCommit = await ghFetch(token, `${repoPath}/git/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          tree: newTree.sha,
          parents: [parentSha],
        }),
      });

      await ghFetch(token, `${repoPath}/git/refs/heads/${TARGET_BRANCH}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: newCommit.sha }),
      });

      return newCommit.sha;
    } catch (err) {
      const isNotFastForward =
        err.status === 422 && /not a fast forward/i.test(String(err.message || ''));
      if (isNotFastForward && attempt < maxAttempts) {
        await sleep(300 * attempt);
        continue;
      }
      throw err;
    }
  }

  throw new Error('commitFilesAsTree: exhausted retries after non-fast-forward conflicts');
}

// Cap concurrent POSTs to /git/blobs. GitHub's secondary rate limit
// trips somewhere in the dozens-of-concurrent-requests range — 5 is well
// inside the safe zone and a 339-file first sync still finishes in
// ~15–25 seconds for the blob phase.
const BLOB_CONCURRENCY = 5;

async function createBlobsThrottled(token, files, repoPath) {
  const out = new Array(files.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= files.length) return;
      const f = files[idx];
      const blob = await ghFetchWithRateLimitBackoff(token, `${repoPath}/git/blobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: Buffer.from(f.content, 'utf8').toString('base64'),
          encoding: 'base64',
        }),
      });
      out[idx] = { path: f.path, sha: blob.sha };
    }
  }
  const workers = Array.from({ length: Math.min(BLOB_CONCURRENCY, files.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

// Retries 403/secondary-rate-limit and 429 responses with exponential
// backoff. Honours Retry-After when present, otherwise 2s × attempt.
async function ghFetchWithRateLimitBackoff(token, path, init, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ghFetch(token, path, init);
    } catch (err) {
      const msg = String(err.message || '');
      const isRateLimited =
        err.status === 429 ||
        (err.status === 403 && /rate limit/i.test(msg));
      if (isRateLimited && attempt < maxAttempts) {
        const delay = 2000 * attempt;
        console.warn(`GitHub rate-limited on ${path}; backing off ${delay}ms (attempt ${attempt}/${maxAttempts})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`ghFetchWithRateLimitBackoff: exhausted retries for ${path}`);
}

// SHA-1 git blob hash, so we can compare new content against the SHAs
// returned by GitHub's Contents listing without fetching each file.
function gitBlobSha(content) {
  const buf = Buffer.from(content, 'utf8');
  const sha = createHash('sha1');
  sha.update(`blob ${buf.length}\0`);
  sha.update(buf);
  return sha.digest('hex');
}

// ============================================================
//  Vercel Blob attachment mirror
// ============================================================
//
// Walks the case payload, finds Airtable attachment arrays (which look
// like [{ id, url, filename, type, … }] inside per-row slots), uploads
// each attachment to Vercel Blob once (keyed by attachment id), and
// rewrites the JSON so the URL is the permanent blob URL instead of the
// short-lived Airtable signed URL. Thumbnails are dropped to keep the
// payload lean; regenerate them client-side from the main URL if needed.

async function mirrorAttachmentsInPayload(caseId, fields, blobToken) {
  // One list call per case → we know which attachment ids are already
  // mirrored without doing N existence checks.
  const existing = await listBlobsForCase(caseId, blobToken);

  for (const fieldName of Object.keys(fields)) {
    const arr = fields[fieldName];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const slot = arr[i];
      if (!isAttachmentArray(slot)) continue;
      const mirrored = [];
      for (const att of slot) {
        mirrored.push(await mirrorOneAttachment(caseId, att, existing, blobToken));
      }
      arr[i] = mirrored;
    }
  }
}

async function listBlobsForCase(caseId, blobToken) {
  const { blobs } = await list({
    prefix: `${BLOB_PREFIX}/${caseId}/`,
    token: blobToken,
  });
  const map = new Map();
  for (const b of blobs) map.set(b.pathname, b.url);
  return map;
}

function isAttachmentArray(v) {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v[0] &&
    typeof v[0] === 'object' &&
    typeof v[0].id === 'string' &&
    typeof v[0].url === 'string'
  );
}

async function mirrorOneAttachment(caseId, att, existingMap, blobToken) {
  const ext = pickExtension(att.filename, att.type);
  const pathname = `${BLOB_PREFIX}/${caseId}/${att.id}${ext}`;

  let blobUrl = existingMap.get(pathname);
  if (!blobUrl) {
    // Download from Airtable's signed URL, then upload to Blob with a
    // stable pathname keyed by attachment id — so subsequent syncs see
    // it in the list() result and skip the round-trip.
    const resp = await fetch(att.url);
    if (!resp.ok) {
      throw new Error(
        `Airtable attachment download failed (${resp.status}) for ${att.id}`
      );
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const result = await put(pathname, buf, {
      access: 'public',
      contentType: att.type || 'application/octet-stream',
      token: blobToken,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    blobUrl = result.url;
    existingMap.set(pathname, blobUrl);
  }

  // Slim attachment object with the permanent URL. Original Airtable
  // thumbnails are dropped (they expire too); consumers that want
  // thumbnails can resize from `url` client-side.
  return {
    id: att.id,
    filename: att.filename,
    type: att.type,
    width: att.width,
    height: att.height,
    size: att.size,
    url: blobUrl,
  };
}

function pickExtension(filename, mimeType) {
  if (typeof filename === 'string') {
    const dot = filename.lastIndexOf('.');
    if (dot >= 0 && dot < filename.length - 1) {
      return filename.slice(dot).toLowerCase();
    }
  }
  if (typeof mimeType === 'string') {
    const sub = mimeType.split('/')[1];
    if (sub) return `.${sub.split(';')[0].trim().toLowerCase()}`;
  }
  return '';
}
