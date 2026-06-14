/**
 * License Detector — Identifies OSS licenses from artifact content and metadata.
 *
 * Detection methods (in priority order):
 *   1. spdx_identifier  — explicit `SPDX-License-Identifier:` tag (confidence: 0.95)
 *   2. license_text     — known full-text or preamble patterns in content (confidence: 0.85)
 *   3. header_pattern   — comment-block license notices in source files (confidence: 0.70)
 *   4. filename         — presence of LICENSE/COPYING file indicators in metadata (confidence: 0.60)
 *   5. none             — no license detected (confidence: 0)
 *
 * Supported SPDX identifiers:
 *   MIT, Apache-2.0, GPL-3.0, GPL-2.0, BSD-2-Clause, BSD-3-Clause,
 *   ISC, MPL-2.0, AGPL-3.0, Unlicense, LGPL-2.1, LGPL-3.0
 */

import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

// ── License Registry ──

const LICENSES = [
  { spdx_id: 'MIT',          name: 'MIT License' },
  { spdx_id: 'Apache-2.0',   name: 'Apache License 2.0' },
  { spdx_id: 'GPL-3.0',      name: 'GNU General Public License v3.0' },
  { spdx_id: 'GPL-2.0',      name: 'GNU General Public License v2.0' },
  { spdx_id: 'BSD-3-Clause', name: 'BSD 3-Clause License' },
  { spdx_id: 'BSD-2-Clause', name: 'BSD 2-Clause License' },
  { spdx_id: 'ISC',          name: 'ISC License' },
  { spdx_id: 'MPL-2.0',      name: 'Mozilla Public License 2.0' },
  { spdx_id: 'AGPL-3.0',     name: 'GNU Affero General Public License v3.0' },
  { spdx_id: 'Unlicense',    name: 'The Unlicense' },
  { spdx_id: 'LGPL-2.1',     name: 'GNU Lesser General Public License v2.1' },
  { spdx_id: 'LGPL-3.0',     name: 'GNU Lesser General Public License v3.0' },
];

const LICENSE_MAP = Object.fromEntries(LICENSES.map(l => [l.spdx_id, l.name]));

// SPDX identifier tag — highest confidence, completely unambiguous
const SPDX_PATTERN = /SPDX-License-Identifier:\s*([A-Za-z0-9\-.+]+)/i;

// Full-text / preamble signatures — enough to be confident it is that exact license
const TEXT_PATTERNS = [
  {
    spdx_id: 'MIT',
    patterns: [
      /permission is hereby granted,\s+free of charge/i,
      /the above copyright notice and this permission notice shall be included/i,
    ],
  },
  {
    spdx_id: 'Apache-2.0',
    patterns: [
      /licensed under the apache license,\s+version 2\.0/i,
      /www\.apache\.org\/licenses\/LICENSE-2\.0/i,
    ],
  },
  {
    spdx_id: 'GPL-3.0',
    patterns: [
      /gnu general public license.*version 3/i,
      /https?:\/\/www\.gnu\.org\/licenses\/gpl-3/i,
    ],
  },
  {
    spdx_id: 'GPL-2.0',
    patterns: [
      /gnu general public license.*version 2/i,
      /https?:\/\/www\.gnu\.org\/licenses\/gpl-2/i,
    ],
  },
  {
    spdx_id: 'AGPL-3.0',
    patterns: [
      /gnu affero general public license.*version 3/i,
      /https?:\/\/www\.gnu\.org\/licenses\/agpl/i,
    ],
  },
  {
    spdx_id: 'LGPL-3.0',
    patterns: [
      /gnu lesser general public license.*version 3/i,
      /https?:\/\/www\.gnu\.org\/licenses\/lgpl-3/i,
    ],
  },
  {
    spdx_id: 'LGPL-2.1',
    patterns: [
      /gnu lesser general public license.*version 2\.1/i,
      /https?:\/\/www\.gnu\.org\/licenses\/lgpl-2\.1/i,
    ],
  },
  {
    spdx_id: 'MPL-2.0',
    patterns: [
      /mozilla public license.*version 2\.0/i,
      /mozilla\.org\/MPL\/2\.0/i,
    ],
  },
  {
    spdx_id: 'BSD-3-Clause',
    patterns: [
      /redistributions? in binary form must reproduce the above copyright/i,
      /neither the name.*nor the names of its contributors/i,
    ],
  },
  {
    spdx_id: 'BSD-2-Clause',
    patterns: [
      /redistributions? of source code must retain the above copyright notice/i,
    ],
  },
  {
    spdx_id: 'ISC',
    patterns: [
      /permission to use,\s+copy,\s+modify.*and\/or distribute/i,
    ],
  },
  {
    spdx_id: 'Unlicense',
    patterns: [
      /this is free and unencumbered software released into the public domain/i,
      /unlicense\.org/i,
    ],
  },
];

// Short comment-block header phrases — sufficient for moderate confidence
const HEADER_PATTERNS = [
  { spdx_id: 'MIT',          pattern: /\blicensed under (?:the )?mit\b/i },
  { spdx_id: 'MIT',          pattern: /\bmit licen[cs]e\b/i },
  { spdx_id: 'Apache-2.0',   pattern: /\blicensed under (?:the )?apache licen[cs]e,?\s+(?:version\s+)?2\.0\b/i },
  { spdx_id: 'Apache-2.0',   pattern: /\bapache-2\.0\b/i },
  { spdx_id: 'GPL-3.0',      pattern: /\bgpl.?v?3\b|\bversion 3 of the gnu/i },
  { spdx_id: 'GPL-2.0',      pattern: /\bgpl.?v?2\b|\bversion 2 of the gnu/i },
  { spdx_id: 'AGPL-3.0',     pattern: /\bagpl.?v?3\b/i },
  { spdx_id: 'LGPL-3.0',     pattern: /\blgpl.?v?3\b/i },
  { spdx_id: 'LGPL-2.1',     pattern: /\blgpl.?v?2\.1\b/i },
  { spdx_id: 'BSD-3-Clause', pattern: /\bbsd.?3.clause\b|\bbsd 3.clause\b/i },
  { spdx_id: 'BSD-2-Clause', pattern: /\bbsd.?2.clause\b|\bbsd 2.clause\b/i },
  { spdx_id: 'ISC',          pattern: /\bisc licen[cs]e\b/i },
  { spdx_id: 'MPL-2.0',      pattern: /\bmpl.?2\.0\b|\bmozilla public licen[cs]e 2/i },
  { spdx_id: 'Unlicense',    pattern: /\bthe unlicen[cs]e\b|\bpublic domain\b/i },
];

// License filenames that signal which license applies (used via type_metadata)
const LICENSE_FILENAMES = /^(LICENSE|LICENCE|COPYING|UNLICENSE)(\.txt|\.md)?$/i;

// ── Detection helpers ──

/**
 * Try SPDX-License-Identifier tag first.
 * @param {string} text
 * @returns {{ spdx_id: string, license_name: string, confidence: number, detection_method: string }|null}
 */
function trySpdxIdentifier(text) {
  const match = SPDX_PATTERN.exec(text);
  if (!match) return null;

  const raw = match[1].trim();
  // Accept known identifiers only; reject malformed/unknown values
  const license = LICENSES.find(l => l.spdx_id.toLowerCase() === raw.toLowerCase());
  if (!license) return null;

  return {
    spdx_id: license.spdx_id,
    license_name: license.name,
    confidence: 0.95,
    detection_method: 'spdx_identifier',
  };
}

/**
 * Match against known license full-text / preamble signatures.
 * @param {string} text
 * @returns {{ spdx_id: string, license_name: string, confidence: number, detection_method: string }|null}
 */
function tryLicenseText(text) {
  for (const entry of TEXT_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return {
          spdx_id: entry.spdx_id,
          license_name: LICENSE_MAP[entry.spdx_id],
          confidence: 0.85,
          detection_method: 'license_text',
        };
      }
    }
  }
  return null;
}

/**
 * Match short comment-block header notices.
 * @param {string} text
 * @returns {{ spdx_id: string, license_name: string, confidence: number, detection_method: string }|null}
 */
function tryHeaderPattern(text) {
  for (const entry of HEADER_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        spdx_id: entry.spdx_id,
        license_name: LICENSE_MAP[entry.spdx_id],
        confidence: 0.70,
        detection_method: 'header_pattern',
      };
    }
  }
  return null;
}

/**
 * Check type_metadata for license filename indicators or pre-detected license field.
 * @param {object} meta - Parsed type_metadata object
 * @returns {{ spdx_id: string|null, license_name: string, confidence: number, detection_method: string }|null}
 */
function tryFilename(meta) {
  if (!meta || typeof meta !== 'object') return null;

  // Explicit license field already in metadata (e.g. from GitHub API)
  const existing = meta.license;
  if (existing && typeof existing === 'string') {
    const license = LICENSES.find(
      l => l.spdx_id.toLowerCase() === existing.toLowerCase() ||
           l.name.toLowerCase() === existing.toLowerCase()
    );
    if (license) {
      return {
        spdx_id: license.spdx_id,
        license_name: license.name,
        confidence: 0.60,
        detection_method: 'filename',
      };
    }
  }

  // filename array or single filename string
  const files = Array.isArray(meta.files) ? meta.files : (meta.filename ? [meta.filename] : []);
  for (const f of files) {
    if (typeof f === 'string' && LICENSE_FILENAMES.test(f)) {
      return {
        spdx_id: null,
        license_name: 'Unknown',
        confidence: 0.60,
        detection_method: 'filename',
      };
    }
  }

  return null;
}

// ── Public API ──

/**
 * Detect the license for an artifact from its content and type_metadata.
 *
 * Detection runs through four methods in priority order and returns on the
 * first match. If nothing is found, returns a zero-confidence 'none' result.
 *
 * @param {string} content        - Raw artifact content (may include license text)
 * @param {object} [typeMetadata] - Parsed type_metadata JSONB from artifacts table
 * @returns {{ spdx_id: string|null, license_name: string, confidence: number, detection_method: string }}
 */
export function detectLicense(content, typeMetadata = {}) {
  const text = typeof content === 'string' ? content : '';
  const meta = (typeMetadata && typeof typeMetadata === 'object') ? typeMetadata : {};

  // 1. SPDX identifier — highest precision
  const bySpdx = trySpdxIdentifier(text);
  if (bySpdx) return bySpdx;

  // 2. Full license text / preamble
  const byText = tryLicenseText(text);
  if (byText) return byText;

  // 3. Short header pattern in comment blocks
  const byHeader = tryHeaderPattern(text);
  if (byHeader) return byHeader;

  // 4. Filename / pre-existing metadata field
  const byFilename = tryFilename(meta);
  if (byFilename) return byFilename;

  // No license detected
  return {
    spdx_id: null,
    license_name: 'Unknown',
    confidence: 0,
    detection_method: 'none',
  };
}

/**
 * Batch-detect licenses for artifacts that have no license_info in type_metadata.
 *
 * Queries the artifacts table for rows where `type_metadata->>'license_info' IS NULL`,
 * calls detectLicense() on each, then writes results back to both
 * `type_metadata.license_info` and `marketplace_metadata.license`.
 *
 * @param {object} [dbClient] - DB client (defaults to shared pool)
 * @param {number} [limit=200] - Maximum rows to process per call
 * @returns {Promise<{ processed: number, licensed: number, unknown: number }>}
 */
export async function detectLicenseBatch(dbClient = db, limit = 200) {
  const result = await dbClient.query(
    `SELECT id, content, type_metadata, marketplace_metadata
     FROM artifacts
     WHERE type_metadata->>'license_info' IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No artifacts require license detection');
    return { processed: 0, licensed: 0, unknown: 0 };
  }

  logger.info(`Detecting licenses for ${result.rows.length} artifacts`);

  let processed = 0;
  let licensed = 0;
  let unknown = 0;

  for (const row of result.rows) {
    try {
      const meta = typeof row.type_metadata === 'string'
        ? JSON.parse(row.type_metadata)
        : (row.type_metadata || {});

      const marketplaceMeta = typeof row.marketplace_metadata === 'string'
        ? JSON.parse(row.marketplace_metadata)
        : (row.marketplace_metadata || {});

      const licenseInfo = detectLicense(row.content || '', meta);

      const updatedMeta = { ...meta, license_info: licenseInfo };
      const updatedMarketplace = {
        ...marketplaceMeta,
        license: licenseInfo.spdx_id || 'unknown',
      };

      await dbClient.query(
        `UPDATE artifacts
         SET type_metadata = $1,
             marketplace_metadata = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [
          JSON.stringify(updatedMeta),
          JSON.stringify(updatedMarketplace),
          row.id,
        ]
      );

      processed++;
      if (licenseInfo.detection_method !== 'none') {
        licensed++;
      } else {
        unknown++;
      }
    } catch (err) {
      logger.error('License detection failed', { id: row.id, error: err.message });
    }
  }

  logger.info('License detection complete', { processed, licensed, unknown });
  return { processed, licensed, unknown };
}
