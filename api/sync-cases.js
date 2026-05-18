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

  // 1. Latest ref on target branch
  const ref = await ghFetch(token, `${repoPath}/git/refs/heads/${TARGET_BRANCH}`);
  const parentSha = ref.object.sha;

  // 2. Tree of the parent commit (so we can extend it rather than replace)
  const parentCommit = await ghFetch(token, `${repoPath}/git/commits/${parentSha}`);
  const parentTreeSha = parentCommit.tree.sha;

  // 3. Create a blob for each changed file (parallel)
  const blobs = await Promise.all(files.map(async (f) => {
    const blob = await ghFetch(token, `${repoPath}/git/blobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: Buffer.from(f.content, 'utf8').toString('base64'),
        encoding: 'base64',
      }),
    });
    return { path: f.path, sha: blob.sha };
  }));

  // 4. New tree based on parent tree, with our blobs layered on top
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

  // 5. New commit pointing at the new tree
  const newCommit = await ghFetch(token, `${repoPath}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [parentSha],
    }),
  });

  // 6. Move the branch ref forward
  await ghFetch(token, `${repoPath}/git/refs/heads/${TARGET_BRANCH}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return newCommit.sha;
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
