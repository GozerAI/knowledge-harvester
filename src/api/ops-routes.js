// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import {
  listOperationLogs,
  summarizeOperationLogs,
  listHarvestRuns,
  getHarvestRunDetails,
  listFailureInbox,
  listSourceHealth,
} from '../db/operation-log-store.js';
import {
  listSystemRuns,
  getSystemRunDetails,
} from '../db/system-run-store.js';
import {
  listSourceRecords,
  summarizeSourceRecords,
} from '../db/source-record-store.js';
import { json, validateUUID } from './middleware.js';

function parseErrorFilters(params) {
  return {
    level: params.get('level') || undefined,
    category: params.get('category') || undefined,
    source: params.get('source') || undefined,
    command: params.get('command') || undefined,
    runId: params.get('run_id') || undefined,
    systemRunId: params.get('system_run_id') || undefined,
    requestPath: params.get('request_path') || undefined,
    search: params.get('search') || undefined,
    sinceHours: params.get('since_hours') || undefined,
    limit: params.get('limit') || undefined,
    offset: params.get('offset') || undefined,
  };
}

function parseRunFilters(params) {
  return {
    status: params.get('status') || undefined,
    source: params.get('source') || undefined,
    limit: params.get('limit') || undefined,
    offset: params.get('offset') || undefined,
  };
}

function parseSystemRunFilters(params) {
  return {
    runType: params.get('run_type') || undefined,
    command: params.get('command') || undefined,
    status: params.get('status') || undefined,
    trigger: params.get('trigger') || undefined,
    limit: params.get('limit') || undefined,
    offset: params.get('offset') || undefined,
  };
}

function parseSourceRecordFilters(params) {
  return {
    source: params.get('source') || undefined,
    decision: params.get('decision') || undefined,
    runId: params.get('run_id') || undefined,
    storedKind: params.get('stored_kind') || undefined,
    artifactType: params.get('artifact_type') || undefined,
    search: params.get('search') || undefined,
    sinceHours: params.get('since_hours') || undefined,
    limit: params.get('limit') || undefined,
    offset: params.get('offset') || undefined,
  };
}

function validateErrorFilterIds(filters) {
  if (filters.runId && !validateUUID(filters.runId)) {
    return 'Invalid run_id';
  }
  if (filters.systemRunId && !validateUUID(filters.systemRunId)) {
    return 'Invalid system_run_id';
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) return '-';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function renderErrorLogPage({ filters, summary, result }) {
  const queryText = new URLSearchParams({
    level: filters.level || '',
    category: filters.category || '',
    source: filters.source || '',
    command: filters.command || '',
    run_id: filters.runId || '',
    system_run_id: filters.systemRunId || '',
    request_path: filters.requestPath || '',
    search: filters.search || '',
    since_hours: String(filters.sinceHours || summary.window_hours || 24),
    limit: String(filters.limit || result.limit || 20),
  }).toString();

  const byLevelRows = summary.by_level.map(entry => `
      <tr><td>${escapeHtml(entry.level)}</td><td>${escapeHtml(entry.count)}</td></tr>
    `).join('');
  const byCategoryRows = summary.by_category.map(entry => `
      <tr><td>${escapeHtml(entry.category)}</td><td>${escapeHtml(entry.count)}</td></tr>
    `).join('');
  const logRows = result.logs.map(log => {
    const emitter = log.source || log.command || log.request_path || '-';
    const harvestLink = log.run_id
      ? `<a href="/api/runs/${escapeHtml(log.run_id)}">${escapeHtml(log.run_id)}</a>`
      : '-';
    const systemLink = log.system_run_id
      ? `<a href="/api/system-runs/${escapeHtml(log.system_run_id)}">${escapeHtml(log.system_run_id)}</a>`
      : '-';
    return `
      <tr>
        <td>${escapeHtml(formatDate(log.created_at))}</td>
        <td><span class="pill pill-${escapeHtml(log.level)}">${escapeHtml(log.level)}</span></td>
        <td>${escapeHtml(log.category)}</td>
        <td>${escapeHtml(log.event_type)}</td>
        <td>${escapeHtml(emitter)}</td>
        <td>${escapeHtml(log.message)}</td>
        <td>${harvestLink}</td>
        <td>${systemLink}</td>
        <td>${escapeHtml(log.error_code || log.error_name || '-')}</td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Knowledge Harvester Error Log</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1d1a14;
      --muted: #6c6558;
      --line: #d8cfbf;
      --accent: #174c63;
      --error: #b42318;
      --warn: #b26a00;
      --info: #17603a;
    }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: linear-gradient(180deg, #efe7d7 0%, var(--bg) 100%); color: var(--ink); }
    main { max-width: 1280px; margin: 0 auto; padding: 32px 20px 48px; }
    h1, h2 { margin: 0 0 12px; }
    p, label, input, select, button, td, th { font-size: 14px; }
    .intro { margin-bottom: 24px; color: var(--muted); }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; box-shadow: 0 10px 24px rgba(29, 26, 20, 0.06); margin-bottom: 18px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .metric { background: #f7f1e5; border-radius: 12px; padding: 14px; border: 1px solid var(--line); }
    .metric strong { display: block; font-size: 24px; margin-top: 6px; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; align-items: end; }
    .filters label { display: grid; gap: 6px; color: var(--muted); }
    .filters input { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: white; color: var(--ink); }
    .actions { display: flex; gap: 10px; align-items: center; }
    .button { display: inline-block; border: 0; border-radius: 999px; background: var(--accent); color: white; padding: 9px 14px; text-decoration: none; cursor: pointer; }
    .button.secondary { background: #d9e5ea; color: var(--accent); }
    .tables { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    .log-table td:nth-child(6) { min-width: 280px; }
    .pill { display: inline-block; border-radius: 999px; padding: 3px 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .pill-error { background: #fbe8e7; color: var(--error); }
    .pill-warn { background: #fff0d8; color: var(--warn); }
    .pill-info { background: #dff3e7; color: var(--info); }
    a { color: var(--accent); }
    .empty { color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  <main>
    <h1>Error Log</h1>
    <p class="intro">Operational warnings and failures from the persisted log store. Use filters to narrow by run, source, request path, or free text.</p>
    <section class="panel">
      <form method="get" action="/api/errors/view" class="filters">
        <label>Level<input name="level" value="${escapeHtml(filters.level || '')}" placeholder="error,warn"></label>
        <label>Category<input name="category" value="${escapeHtml(filters.category || '')}" placeholder="pipeline"></label>
        <label>Source<input name="source" value="${escapeHtml(filters.source || '')}" placeholder="github"></label>
        <label>Command<input name="command" value="${escapeHtml(filters.command || '')}" placeholder="pipeline"></label>
        <label>Run ID<input name="run_id" value="${escapeHtml(filters.runId || '')}" placeholder="harvest run id"></label>
        <label>System Run ID<input name="system_run_id" value="${escapeHtml(filters.systemRunId || '')}" placeholder="command or pipeline run id"></label>
        <label>Request Path<input name="request_path" value="${escapeHtml(filters.requestPath || '')}" placeholder="/api/pipeline/run"></label>
        <label>Search<input name="search" value="${escapeHtml(filters.search || '')}" placeholder="timeout"></label>
        <label>Since Hours<input name="since_hours" value="${escapeHtml(filters.sinceHours || summary.window_hours || 24)}"></label>
        <label>Limit<input name="limit" value="${escapeHtml(filters.limit || result.limit || 20)}"></label>
        <div class="actions">
          <button class="button" type="submit">Apply</button>
          <a class="button secondary" href="/api/errors/view">Reset</a>
          <a class="button secondary" href="/api/errors?${queryText}">JSON</a>
        </div>
      </form>
    </section>
    <section class="metrics">
      <article class="metric"><span>Total matching logs</span><strong>${escapeHtml(summary.total)}</strong></article>
      <article class="metric"><span>Window</span><strong>${escapeHtml(summary.window_hours)}h</strong></article>
      <article class="metric"><span>Shown on page</span><strong>${escapeHtml(result.logs.length)}</strong></article>
    </section>
    <section class="tables">
      <article class="panel">
        <h2>By Level</h2>
        <table>
          <thead><tr><th>Level</th><th>Count</th></tr></thead>
          <tbody>${byLevelRows || '<tr><td colspan="2" class="empty">No matching entries.</td></tr>'}</tbody>
        </table>
      </article>
      <article class="panel">
        <h2>By Category</h2>
        <table>
          <thead><tr><th>Category</th><th>Count</th></tr></thead>
          <tbody>${byCategoryRows || '<tr><td colspan="2" class="empty">No matching entries.</td></tr>'}</tbody>
        </table>
      </article>
    </section>
    <section class="panel">
      <h2>Entries</h2>
      <table class="log-table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Level</th>
            <th>Category</th>
            <th>Event</th>
            <th>Emitter</th>
            <th>Message</th>
            <th>Run</th>
            <th>System Run</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>${logRows || '<tr><td colspan="9" class="empty">No matching log entries.</td></tr>'}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

export function createOpsHandlers({ database = db } = {}) {
  return {
    async handleListErrors(_req, res, params) {
      const filters = parseErrorFilters(params);
      const validationError = validateErrorFilterIds(filters);
      if (validationError) {
        return json(res, 400, { error: validationError });
      }

      try {
        const result = await listOperationLogs(database, filters);
        return json(res, 200, {
          errors: result.logs,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        });
      } catch {
        return json(res, 500, { error: 'Failed to list operation logs' });
      }
    },

    async handleErrorSummary(_req, res, params) {
      const filters = parseErrorFilters(params);
      const validationError = validateErrorFilterIds(filters);
      if (validationError) {
        return json(res, 400, { error: validationError });
      }

      try {
        const summary = await summarizeOperationLogs(database, filters);
        return json(res, 200, summary);
      } catch {
        return json(res, 500, { error: 'Failed to summarize operation logs' });
      }
    },

    async handleErrorLogPage(_req, res, params) {
      const filters = parseErrorFilters(params);
      const validationError = validateErrorFilterIds(filters);
      if (validationError) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<p>${escapeHtml(validationError)}</p>`);
        return;
      }

      try {
        const [summary, result] = await Promise.all([
          summarizeOperationLogs(database, filters),
          listOperationLogs(database, filters),
        ]);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderErrorLogPage({ filters, summary, result }));
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Failed to render error log page</p>');
      }
    },

    async handleFailureInbox(_req, res, params) {
      try {
        const inbox = await listFailureInbox(database, {
          limit: params.get('limit') || undefined,
          sinceHours: params.get('since_hours') || undefined,
        });
        return json(res, 200, inbox);
      } catch {
        return json(res, 500, { error: 'Failed to build failure inbox' });
      }
    },

    async handleListRuns(_req, res, params) {
      try {
        const result = await listHarvestRuns(database, parseRunFilters(params));
        return json(res, 200, {
          runs: result.runs,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        });
      } catch {
        return json(res, 500, { error: 'Failed to list harvest runs' });
      }
    },

    async handleGetRun(_req, res, params, runId) {
      if (!validateUUID(runId)) {
        return json(res, 400, { error: 'Invalid run id' });
      }

      try {
        const details = await getHarvestRunDetails(database, runId, {
          logLimit: params.get('log_limit') || undefined,
        });
        if (!details) {
          return json(res, 404, { error: 'Harvest run not found' });
        }

        return json(res, 200, details);
      } catch {
        return json(res, 500, { error: 'Failed to get harvest run details' });
      }
    },

    async handleSourceHealth(_req, res, params) {
      try {
        const result = await listSourceHealth(database, {
          limit: params.get('limit') || undefined,
          sinceHours: params.get('since_hours') || undefined,
        });
        return json(res, 200, result);
      } catch {
        return json(res, 500, { error: 'Failed to get source health' });
      }
    },

    async handleListSystemRuns(_req, res, params) {
      try {
        const result = await listSystemRuns(database, parseSystemRunFilters(params));
        return json(res, 200, {
          runs: result.runs,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        });
      } catch {
        return json(res, 500, { error: 'Failed to list system runs' });
      }
    },

    async handleListSourceRecords(_req, res, params) {
      const filters = parseSourceRecordFilters(params);
      if (filters.runId && !validateUUID(filters.runId)) {
        return json(res, 400, { error: 'Invalid run_id' });
      }

      try {
        const result = await listSourceRecords(database, filters);
        return json(res, 200, {
          records: result.records,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        });
      } catch {
        return json(res, 500, { error: 'Failed to list source records' });
      }
    },

    async handleSourceRecordSummary(_req, res, params) {
      const filters = parseSourceRecordFilters(params);
      if (filters.runId && !validateUUID(filters.runId)) {
        return json(res, 400, { error: 'Invalid run_id' });
      }

      try {
        const summary = await summarizeSourceRecords(database, filters);
        return json(res, 200, summary);
      } catch {
        return json(res, 500, { error: 'Failed to summarize source records' });
      }
    },

    async handleGetSystemRun(_req, res, params, runId) {
      if (!validateUUID(runId)) {
        return json(res, 400, { error: 'Invalid system run id' });
      }

      try {
        const details = await getSystemRunDetails(database, runId, {
          logLimit: params.get('log_limit') || undefined,
        });
        if (!details) {
          return json(res, 404, { error: 'System run not found' });
        }

        return json(res, 200, details);
      } catch {
        return json(res, 500, { error: 'Failed to get system run details' });
      }
    },
  };
}

const handlers = createOpsHandlers();

export const handleListErrors = handlers.handleListErrors;
export const handleErrorSummary = handlers.handleErrorSummary;
export const handleErrorLogPage = handlers.handleErrorLogPage;
export const handleFailureInbox = handlers.handleFailureInbox;
export const handleListRuns = handlers.handleListRuns;
export const handleGetRun = handlers.handleGetRun;
export const handleSourceHealth = handlers.handleSourceHealth;
export const handleListSystemRuns = handlers.handleListSystemRuns;
export const handleGetSystemRun = handlers.handleGetSystemRun;
export const handleListSourceRecords = handlers.handleListSourceRecords;
export const handleSourceRecordSummary = handlers.handleSourceRecordSummary;
