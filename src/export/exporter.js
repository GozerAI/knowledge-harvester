// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Exporter — Export artifacts in multiple formats.
 *
 * Supported formats:
 *   - json:   Pretty-printed JSON
 *   - yaml:   Simple YAML serialization (no external deps)
 *   - tar.gz: Gzipped tar archive containing artifact.json, README.md,
 *             .env.example, and docker-compose.yml (when applicable)
 *
 * Uses only Node.js built-in modules (zlib for compression).
 */

import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ── YAML Serializer ──────────────────────────────────────────────────────────

/**
 * Serialize a value to YAML string with the given indentation level.
 * Handles: strings, numbers, booleans, null, arrays, objects.
 */
function serializeYamlValue(value, indent) {
  const pad = ' '.repeat(indent);

  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    // Quote strings that contain special characters or look like other types
    if (
      value === '' ||
      value.includes('\n') ||
      value.includes(':') ||
      value.includes('#') ||
      value.includes('"') ||
      value.includes("'") ||
      /^(true|false|null|yes|no|on|off)$/i.test(value) ||
      /^[-+]?\d/.test(value)
    ) {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const lines = value.map(item => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const inner = serializeYamlObject(item, indent + 2);
        return `${pad}- ${inner.trimStart()}`;
      }
      return `${pad}- ${serializeYamlValue(item, indent + 2)}`;
    });
    return '\n' + lines.join('\n');
  }

  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return '{}';
    return '\n' + serializeYamlObject(value, indent + 2);
  }

  return String(value);
}

/**
 * Serialize an object's key-value pairs at the given indentation level.
 */
function serializeYamlObject(obj, indent) {
  const pad = ' '.repeat(indent);
  return Object.entries(obj)
    .map(([key, value]) => {
      const serialized = serializeYamlValue(value, indent);
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0) {
        return `${pad}${key}:${serialized}`;
      }
      if (Array.isArray(value) && value.length > 0) {
        return `${pad}${key}:${serialized}`;
      }
      return `${pad}${key}: ${serialized}`;
    })
    .join('\n');
}

/**
 * Convert a JavaScript object to a YAML string.
 * Simple implementation — no external dependencies.
 */
export function toYaml(obj) {
  if (obj === null || obj === undefined) return 'null\n';
  if (typeof obj !== 'object') return serializeYamlValue(obj, 0) + '\n';
  if (Array.isArray(obj)) return serializeYamlValue(obj, 0).trimStart() + '\n';
  return serializeYamlObject(obj, 0) + '\n';
}

// ── README Generation ────────────────────────────────────────────────────────

/**
 * Generate a README.md for an artifact.
 */
export function generateReadme(artifact) {
  const name = artifact.name || 'Artifact';
  const description = artifact.description || 'No description provided.';
  const artifactType = artifact.artifact_type || 'artifact';
  const typeMeta = artifact.type_metadata || {};
  const toolType = artifact.tool_type || null;
  const language = artifact.language || null;
  const tags = artifact.tags || [];
  const source = artifact.source || null;
  const sourceUrl = artifact.source_url || null;

  const lines = [
    `# ${name}`,
    '',
    `**Type:** ${artifactType}${toolType ? ` (${toolType})` : ''}${language ? ` · **Language:** ${language}` : ''}`,
    '',
    '## Description',
    '',
    description,
    '',
  ];

  // Type-specific metadata section
  const metaEntries = Object.entries(typeMeta).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (metaEntries.length > 0) {
    lines.push('## Details', '');
    for (const [key, value] of metaEntries) {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (Array.isArray(value)) {
        lines.push(`- **${label}:** ${value.join(', ')}`);
      } else if (typeof value === 'object') {
        lines.push(`- **${label}:** ${JSON.stringify(value)}`);
      } else {
        lines.push(`- **${label}:** ${value}`);
      }
    }
    lines.push('');
  }

  // Tags
  if (tags.length > 0) {
    lines.push('## Tags', '');
    lines.push(tags.map(t => `\`${t}\``).join(' '));
    lines.push('');
  }

  // Setup section
  lines.push('## Setup', '');
  lines.push('1. Copy `.env.example` to `.env` and fill in the required values.');
  lines.push('2. Review `docker-compose.yml` if running with Docker.');
  lines.push('3. Import or deploy the artifact according to the platform documentation.');
  lines.push('');

  // Source attribution
  if (source || sourceUrl) {
    lines.push('## Source', '');
    if (sourceUrl) {
      lines.push(`- **URL:** ${sourceUrl}`);
    }
    if (source) {
      lines.push(`- **Platform:** ${source}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── .env.example Generation ──────────────────────────────────────────────────

/**
 * Generate a .env.example file from artifact credential and env var metadata.
 */
export function generateEnvExample(artifact) {
  const typeMeta = artifact.type_metadata || {};
  const toolType = artifact.tool_type || '';
  const lines = ['# Environment variables for this artifact', '# Copy this file to .env and fill in the values', ''];

  const credentialsRequired = artifact.credentials_required ||
    typeMeta.credentials_required ||
    typeMeta.env_vars ||
    [];

  // Tool-specific env var stubs
  const toolEnvDefaults = {
    n8n: [
      'N8N_HOST=http://localhost:5678',
      'N8N_BASIC_AUTH_USER=admin',
      'N8N_BASIC_AUTH_PASSWORD=changeme',
      'DB_TYPE=postgresdb',
      'DB_POSTGRESDB_HOST=localhost',
      'DB_POSTGRESDB_PORT=5432',
      'DB_POSTGRESDB_DATABASE=n8n',
      'DB_POSTGRESDB_USER=n8n',
      'DB_POSTGRESDB_PASSWORD=changeme',
    ],
    airflow: [
      'AIRFLOW_HOME=/opt/airflow',
      'AIRFLOW__DATABASE__SQL_ALCHEMY_CONN=postgresql+psycopg2://airflow:airflow@localhost/airflow',
      'AIRFLOW__CORE__EXECUTOR=LocalExecutor',
      'AIRFLOW__WEBSERVER__SECRET_KEY=changeme',
    ],
    temporal: [
      'TEMPORAL_HOST=localhost:7233',
      'TEMPORAL_NAMESPACE=default',
    ],
    prefect: [
      'PREFECT_API_URL=http://localhost:4200/api',
      'PREFECT_API_KEY=',
    ],
    dagster: [
      'DAGSTER_HOME=/opt/dagster',
      'DAGSTER_PG_HOST=localhost',
      'DAGSTER_PG_USER=dagster',
      'DAGSTER_PG_PASSWORD=changeme',
      'DAGSTER_PG_DB=dagster',
    ],
    mlflow: [
      'MLFLOW_TRACKING_URI=http://localhost:5000',
      'MLFLOW_EXPERIMENT_NAME=default',
    ],
    comfyui: [
      'COMFYUI_URL=http://localhost:8188',
    ],
    flowise: [
      'FLOWISE_URL=http://localhost:3000',
      'FLOWISE_USERNAME=',
      'FLOWISE_PASSWORD=',
    ],
    dify: [
      'DIFY_API_URL=http://localhost',
      'DIFY_API_KEY=',
    ],
    'github-actions': [
      'GITHUB_TOKEN=ghp_your_token_here',
    ],
    'home-assistant': [
      'HASS_URL=http://homeassistant.local:8123',
      'HASS_TOKEN=your_long_lived_access_token',
    ],
    tekton: [
      'KUBECONFIG=/home/user/.kube/config',
    ],
    argo: [
      'ARGO_SERVER=https://argo.example.com',
      'ARGO_TOKEN=',
      'KUBECONFIG=/home/user/.kube/config',
    ],
  };

  // Add credential placeholders derived from credentials_required array
  const seen = new Set();
  for (const cred of credentialsRequired) {
    if (typeof cred === 'string' && cred.trim()) {
      const envName = cred.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
      if (!seen.has(envName)) {
        seen.add(envName);
        lines.push(`${envName}=`);
      }
    } else if (cred && typeof cred === 'object') {
      const envName = (cred.name || cred.key || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
      if (envName && !seen.has(envName)) {
        seen.add(envName);
        const desc = cred.description ? ` # ${cred.description}` : '';
        lines.push(`${envName}=${desc}`);
      }
    }
  }

  // Add tool-specific defaults
  const toolDefaults = toolEnvDefaults[toolType] || [];
  if (toolDefaults.length > 0) {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`# ${toolType} configuration`);
    for (const entry of toolDefaults) {
      if (!seen.has(entry.split('=')[0])) {
        lines.push(entry);
      }
    }
  }

  if (lines[lines.length - 1] !== '') lines.push('');
  return lines.join('\n');
}

// ── Docker Compose Generation ────────────────────────────────────────────────

/**
 * Generate a docker-compose.yml for an artifact based on its tool type.
 */
export function generateDockerCompose(artifact) {
  const toolType = artifact.tool_type || '';
  const name = (artifact.name || 'artifact').toLowerCase().replace(/[^a-z0-9]/g, '-');

  const composeTemplates = {
    n8n: () => `version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    container_name: ${name}-n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=\${N8N_HOST:-localhost}
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=\${N8N_BASIC_AUTH_USER:-admin}
      - N8N_BASIC_AUTH_PASSWORD=\${N8N_BASIC_AUTH_PASSWORD:-changeme}
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=\${DB_POSTGRESDB_DATABASE:-n8n}
      - DB_POSTGRESDB_USER=\${DB_POSTGRESDB_USER:-n8n}
      - DB_POSTGRESDB_PASSWORD=\${DB_POSTGRESDB_PASSWORD:-changeme}
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      - postgres
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:5678/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15
    container_name: ${name}-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=\${DB_POSTGRESDB_DATABASE:-n8n}
      - POSTGRES_USER=\${DB_POSTGRESDB_USER:-n8n}
      - POSTGRES_PASSWORD=\${DB_POSTGRESDB_PASSWORD:-changeme}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${DB_POSTGRESDB_USER:-n8n}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  n8n_data:
  postgres_data:

networks:
  default:
    name: ${name}-network
`,

    airflow: () => `version: '3.8'

x-airflow-common: &airflow-common
  image: apache/airflow:2.9.0
  environment:
    - AIRFLOW__DATABASE__SQL_ALCHEMY_CONN=\${AIRFLOW__DATABASE__SQL_ALCHEMY_CONN}
    - AIRFLOW__CORE__EXECUTOR=LocalExecutor
    - AIRFLOW__WEBSERVER__SECRET_KEY=\${AIRFLOW__WEBSERVER__SECRET_KEY:-changeme}
  volumes:
    - ./dags:/opt/airflow/dags
    - airflow_logs:/opt/airflow/logs

services:
  airflow-webserver:
    <<: *airflow-common
    container_name: ${name}-webserver
    ports:
      - "8080:8080"
    command: webserver
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 5

  airflow-scheduler:
    <<: *airflow-common
    container_name: ${name}-scheduler
    command: scheduler

  postgres:
    image: postgres:15
    container_name: ${name}-postgres
    environment:
      - POSTGRES_USER=airflow
      - POSTGRES_PASSWORD=airflow
      - POSTGRES_DB=airflow
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  airflow_logs:
  postgres_data:
`,

    mlflow: () => `version: '3.8'

services:
  mlflow:
    image: ghcr.io/mlflow/mlflow:latest
    container_name: ${name}-mlflow
    ports:
      - "5000:5000"
    environment:
      - MLFLOW_TRACKING_URI=\${MLFLOW_TRACKING_URI:-http://localhost:5000}
    command: mlflow server --host 0.0.0.0 --port 5000 --backend-store-uri sqlite:///mlflow.db
    volumes:
      - mlflow_data:/mlflow
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  mlflow_data:
`,
  };

  if (composeTemplates[toolType]) {
    return composeTemplates[toolType]();
  }

  // Generic fallback
  const artifactType = artifact.artifact_type || 'artifact';
  return `version: '3.8'

# Docker Compose configuration for: ${artifact.name || 'artifact'}
# Artifact type: ${artifactType}${toolType ? ` (${toolType})` : ''}
#
# Customize this file for your specific deployment needs.

services:
  app:
    image: your-image:latest
    container_name: ${name}
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes: {}

networks:
  default:
    name: ${name}-network
`;
}

// ── Tar Archive Creation ─────────────────────────────────────────────────────

/**
 * Create a raw tar buffer from an array of file entries.
 * Uses the POSIX ustar format (512-byte headers + padded file blocks).
 *
 * @param {Array<{ name: string, content: string|Buffer }>} files
 * @returns {Buffer} Raw tar buffer (uncompressed)
 */
export function createTarBuffer(files) {
  const blocks = [];

  for (const file of files) {
    const contentBuf = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf8');

    const size = contentBuf.length;
    const header = createTarHeader(file.name, size);
    blocks.push(header);
    blocks.push(contentBuf);

    // Pad content to 512-byte boundary
    const remainder = size % 512;
    if (remainder !== 0) {
      blocks.push(Buffer.alloc(512 - remainder, 0));
    }
  }

  // Two 512-byte zero blocks mark end of archive
  blocks.push(Buffer.alloc(1024, 0));

  return Buffer.concat(blocks);
}

/**
 * Create a 512-byte ustar tar header for a single file.
 */
function createTarHeader(name, size) {
  const header = Buffer.alloc(512, 0);

  // Encode a string into tar header at offset, max length bytes (null-padded)
  const writeStr = (offset, str, maxLen) => {
    const buf = Buffer.from(str, 'utf8');
    buf.copy(header, offset, 0, Math.min(buf.length, maxLen));
  };

  // Write octal number (null + space terminated for size/mode/uid/gid/mtime)
  const writeOctal = (offset, value, length) => {
    const octal = value.toString(8).padStart(length - 1, '0');
    Buffer.from(octal + '\0').copy(header, offset);
  };

  writeStr(0, name, 100);           // name
  writeStr(100, '0000644\0', 8);    // mode
  writeStr(108, '0000000\0', 8);    // uid
  writeStr(116, '0000000\0', 8);    // gid
  writeOctal(124, size, 12);        // size
  writeOctal(136, Math.floor(Date.now() / 1000), 12); // mtime
  writeStr(156, '0', 1);            // typeflag: regular file
  writeStr(257, 'ustar', 5);        // magic
  writeStr(263, '00', 2);           // version
  writeStr(265, 'harvester', 32);   // uname
  writeStr(297, 'harvester', 32);   // gname

  // Compute and write checksum
  let checksum = 0;
  // Treat checksum bytes (148-155) as spaces for computation
  for (let i = 0; i < 512; i++) {
    checksum += (i >= 148 && i < 156) ? 32 : header[i];
  }
  writeStr(148, checksum.toString(8).padStart(6, '0') + '\0 ', 8);

  return header;
}

/**
 * Create a gzipped tar buffer from an array of file entries.
 *
 * @param {Array<{ name: string, content: string|Buffer }>} files
 * @returns {Promise<Buffer>} Gzipped tar buffer
 */
export async function createTarGz(files) {
  const tarBuffer = createTarBuffer(files);
  return gzip(tarBuffer);
}

// ── Main Export Functions ────────────────────────────────────────────────────

/**
 * Export an artifact to the specified format.
 *
 * @param {object} artifact - Normalized artifact object
 * @param {'json'|'yaml'|'tar.gz'} format
 * @returns {Promise<string|Buffer>} Exported content
 */
export async function exportArtifact(artifact, format) {
  switch (format) {
    case 'json': {
      return JSON.stringify(artifact, null, 2);
    }

    case 'yaml': {
      return toYaml(artifact);
    }

    case 'tar.gz': {
      const files = [];

      // artifact.json — the full artifact data
      files.push({
        name: 'artifact.json',
        content: JSON.stringify(artifact, null, 2),
      });

      // README.md
      files.push({
        name: 'README.md',
        content: generateReadme(artifact),
      });

      // .env.example
      files.push({
        name: '.env.example',
        content: generateEnvExample(artifact),
      });

      // docker-compose.yml (always include for operational artifacts)
      const hasDockerCompose = [
        'workflow', 'infra_config', 'ai_ml_asset', 'code_pattern',
      ].includes(artifact.artifact_type);

      if (hasDockerCompose || artifact.tool_type) {
        files.push({
          name: 'docker-compose.yml',
          content: generateDockerCompose(artifact),
        });
      }

      return createTarGz(files);
    }

    default:
      throw new Error(`Unsupported export format: ${format}. Supported: json, yaml, tar.gz`);
  }
}

/**
 * Export an artifact by ID from the database.
 *
 * @param {object} db - Database client with .query() method
 * @param {string} id - Artifact UUID
 * @param {'json'|'yaml'|'tar.gz'} format
 * @returns {Promise<string|Buffer>}
 */
export async function exportArtifactById(db, id, format) {
  const result = await db.query(
    `SELECT id, hash, artifact_type, source, source_url, source_id,
            discovered_at, updated_at, content, name, description,
            author_username, author_profile_url,
            language, tool_type, tool_metadata, tags,
            type_metadata, primary_category, secondary_categories,
            quality_score, complexity_score,
            has_description, has_documentation,
            is_complete, validation_status,
            publishing_status, marketplace_metadata,
            credentials_required
     FROM artifacts
     WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error(`Artifact not found: ${id}`);
  }

  const row = result.rows[0];

  // Parse JSONB fields
  const artifact = {
    ...row,
    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    tool_metadata: typeof row.tool_metadata === 'string' ? JSON.parse(row.tool_metadata) : (row.tool_metadata || {}),
    type_metadata: typeof row.type_metadata === 'string' ? JSON.parse(row.type_metadata) : (row.type_metadata || {}),
    marketplace_metadata: typeof row.marketplace_metadata === 'string' ? JSON.parse(row.marketplace_metadata) : (row.marketplace_metadata || {}),
  };

  return exportArtifact(artifact, format);
}
