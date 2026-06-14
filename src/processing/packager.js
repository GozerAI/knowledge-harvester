// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

/**
 * Generate deployment packages for workflows that don't have one yet.
 * Analyzes workflow definitions to extract dependencies, credentials,
 * environment variables, and service requirements.
 *
 * @param {number} limit - Max number of workflows to package
 * @returns {{ packaged: number, failed: number }}
 */
export async function packageWorkflows(limit = 50) {
  const result = await db.query(
    `SELECT w.id, w.workflow_name, w.workflow_json, w.tool_type, w.language,
            w.primary_category, w.estimated_complexity, w.tags,
            w.node_types, w.credentials_required, w.tool_metadata
     FROM workflows w
     LEFT JOIN workflow_packages p ON p.workflow_id = w.id
     WHERE p.id IS NULL AND w.quality_score > 0
     ORDER BY w.quality_score DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    logger.info('No workflows to package');
    return { packaged: 0, failed: 0 };
  }

  logger.info(`Packaging ${result.rows.length} workflows`);
  let packaged = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const bundle = generateBundle(row);
      const deps = bundle.package.dependencies || [];
      const credCount = (bundle.package.credentials || []).length;
      const envCount = (bundle.package.environment_variables || []).length;
      const setupTime = estimateSetupTime(bundle);

      await db.query(
        `INSERT INTO workflow_packages (workflow_id, bundle, dependencies, credentials_count, env_vars_count, estimated_setup_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workflow_id) DO UPDATE SET
           bundle = $2, dependencies = $3, credentials_count = $4,
           env_vars_count = $5, estimated_setup_minutes = $6,
           package_version = workflow_packages.package_version + 1,
           generated_at = NOW()`,
        [row.id, JSON.stringify(bundle), deps, credCount, envCount, setupTime]
      );

      packaged++;
      logger.debug('Packaged workflow', { id: row.id, deps: deps.length, creds: credCount });
    } catch (err) {
      logger.error('Packaging failed', { id: row.id, error: err.message });
      failed++;
    }
  }

  logger.info('Packaging complete', { packaged, failed });
  return { packaged, failed };
}

/**
 * Generate a deployment bundle for a single workflow.
 */
function generateBundle(row) {
  const toolType = row.tool_type || 'n8n';
  const wfJson = typeof row.workflow_json === 'string'
    ? JSON.parse(row.workflow_json) : (row.workflow_json || {});
  const toolMeta = typeof row.tool_metadata === 'string'
    ? JSON.parse(row.tool_metadata) : (row.tool_metadata || {});

  const deps = extractDependencies(toolType, wfJson, toolMeta);
  const creds = extractCredentials(toolType, wfJson, row.credentials_required || []);
  const envVars = extractEnvVars(toolType, creds);
  const services = extractServices(toolType, wfJson, toolMeta);
  const minReqs = getMinimumRequirements(toolType);

  return {
    bundle_version: '1.0',
    workflow_id: row.id,
    workflow_name: row.workflow_name,
    tool_type: toolType,
    package: {
      workflow_definition: wfJson,
      dependencies: deps,
      credentials: creds,
      environment_variables: envVars,
      services,
      minimum_requirements: minReqs,
    },
    metadata: {
      category: row.primary_category || 'general-productivity',
      complexity: row.estimated_complexity || 'moderate',
      estimated_setup_time_minutes: estimateSetupTime({ package: { dependencies: deps, credentials: creds, services } }),
      tags: row.tags || [],
    },
  };
}

/**
 * Extract dependencies based on tool_type.
 */
function extractDependencies(toolType, wfJson, toolMeta) {
  const deps = new Set();

  switch (toolType) {
    case 'n8n': {
      // Extract n8n node packages from nodes[].type
      const nodes = wfJson.nodes || [];
      for (const node of nodes) {
        if (node.type?.startsWith('n8n-nodes-base.')) deps.add('n8n-nodes-base');
        else if (node.type?.startsWith('@n8n/')) {
          const pkg = node.type.split('.')[0];
          deps.add(pkg);
        }
        else if (node.type?.includes('.')) {
          const pkg = node.type.split('.')[0];
          if (pkg && pkg !== 'n8n-nodes-base') deps.add(pkg);
        }
      }
      break;
    }

    case 'comfyui': {
      // ComfyUI custom node packages from class_type
      deps.add('ComfyUI');
      const classTypes = toolMeta.class_types || [];
      // Common custom node packs
      const customNodeMap = {
        'ControlNetApply': 'comfyui-controlnet',
        'IPAdapter': 'ComfyUI_IPAdapter_plus',
        'FaceRestore': 'comfyui-reactor',
        'UpscaleModelLoader': 'comfyui-upscaler',
      };
      for (const ct of classTypes) {
        for (const [key, pkg] of Object.entries(customNodeMap)) {
          if (ct.includes(key)) deps.add(pkg);
        }
      }
      break;
    }

    case 'flowise': {
      // Flowise nodes map to LangChain packages
      deps.add('flowise');
      const nodeNames = toolMeta.node_names || [];
      const langchainPkgs = {
        'chatOpenAI': '@langchain/openai',
        'ChatOpenAI': '@langchain/openai',
        'chatAnthropic': '@langchain/anthropic',
        'pdfLoader': 'pdf-parse',
        'chromaDB': 'chromadb',
        'pinecone': '@pinecone-database/pinecone',
        'weaviate': 'weaviate-ts-client',
        'qdrant': '@qdrant/js-client-rest',
      };
      for (const name of nodeNames) {
        for (const [key, pkg] of Object.entries(langchainPkgs)) {
          if (name.toLowerCase().includes(key.toLowerCase())) deps.add(pkg);
        }
      }
      break;
    }

    case 'activepieces': {
      // Activepieces pieces
      deps.add('activepieces');
      const pieces = toolMeta.pieces || [];
      for (const piece of pieces) {
        deps.add(`@activepieces/piece-${piece}`);
      }
      break;
    }

    case 'argo': {
      // Container images from Argo specs
      deps.add('argo-workflows');
      const images = toolMeta.images || [];
      for (const img of images) {
        deps.add(img);
      }
      break;
    }

    case 'tekton': {
      deps.add('tekton-pipelines');
      const images = toolMeta.images || [];
      for (const img of images) deps.add(img);
      break;
    }

    case 'github-actions': {
      deps.add('github-actions');
      const actions = toolMeta.actions_used || [];
      for (const action of actions) deps.add(action);
      break;
    }

    case 'home-assistant': {
      deps.add('homeassistant');
      const integrations = toolMeta.integrations || [];
      for (const integ of integrations) deps.add(`hacs:${integ}`);
      break;
    }

    case 'dbt': {
      deps.add('dbt-core');
      const code = wfJson.source_code || (typeof wfJson === 'string' ? wfJson : '');
      if (code.includes('postgres') || code.includes('PostgreSQL')) deps.add('dbt-postgres');
      if (code.includes('bigquery') || code.includes('BigQuery')) deps.add('dbt-bigquery');
      if (code.includes('snowflake') || code.includes('Snowflake')) deps.add('dbt-snowflake');
      if (code.includes('redshift')) deps.add('dbt-redshift');
      break;
    }

    case 'camunda': {
      deps.add('camunda-bpm');
      break;
    }

    case 'kafka-connect': {
      deps.add('kafka-connect');
      const connClass = toolMeta.connector_class || '';
      if (connClass) deps.add(connClass);
      if (connClass.includes('debezium')) deps.add('debezium');
      break;
    }

    case 'camel': {
      deps.add('apache-camel');
      const components = toolMeta.components_used || [];
      for (const comp of components) deps.add(`camel-${comp}`);
      break;
    }

    // Python-based tools: extract imports
    case 'temporal':
    case 'airflow':
    case 'prefect':
    case 'dagster':
    case 'langgraph':
    case 'luigi':
    case 'mlflow':
    case 'dify': {
      const code = wfJson.source_code || (typeof wfJson === 'string' ? wfJson : '');
      const imports = extractPythonImports(code);
      for (const imp of imports) deps.add(imp);
      // Add the main framework package
      const frameworkPkgs = {
        temporal: 'temporalio',
        airflow: 'apache-airflow',
        prefect: 'prefect',
        dagster: 'dagster',
        langgraph: 'langgraph',
        luigi: 'luigi',
        mlflow: 'mlflow',
        dify: 'dify-client',
      };
      if (frameworkPkgs[toolType]) deps.add(frameworkPkgs[toolType]);
      break;
    }

    // JavaScript-based: extract from defineComponent
    case 'pipedream': {
      deps.add('@pipedream/platform');
      const code = wfJson.source_code || (typeof wfJson === 'string' ? wfJson : '');
      const requires = code.match(/require\(["']([^"']+)["']\)/g) || [];
      for (const r of requires) {
        const pkg = r.match(/["']([^"']+)["']/)?.[1];
        if (pkg && !pkg.startsWith('.') && !pkg.startsWith('/')) deps.add(pkg);
      }
      const imports = code.match(/from\s+["']([^"']+)["']/g) || [];
      for (const i of imports) {
        const pkg = i.match(/["']([^"']+)["']/)?.[1];
        if (pkg && !pkg.startsWith('.') && !pkg.startsWith('/')) deps.add(pkg);
      }
      break;
    }

    default: {
      // Generic: try Python imports
      const code = wfJson.source_code || '';
      if (code) {
        const imports = extractPythonImports(code);
        for (const imp of imports) deps.add(imp);
      }
    }
  }

  return [...deps];
}

/**
 * Extract Python import package names from source code.
 */
function extractPythonImports(code) {
  const packages = new Set();
  if (!code || typeof code !== 'string') return packages;

  // from X import Y
  const fromImports = code.match(/^from\s+(\w+)/gm) || [];
  for (const m of fromImports) {
    const pkg = m.match(/from\s+(\w+)/)?.[1];
    if (pkg && !isStdlib(pkg)) packages.add(pkg);
  }

  // import X
  const directImports = code.match(/^import\s+(\w+)/gm) || [];
  for (const m of directImports) {
    const pkg = m.match(/import\s+(\w+)/)?.[1];
    if (pkg && !isStdlib(pkg)) packages.add(pkg);
  }

  return packages;
}

/**
 * Check if a Python package is part of the standard library.
 */
function isStdlib(pkg) {
  const stdlib = new Set([
    'os', 'sys', 'json', 'time', 'datetime', 'logging', 'typing', 'pathlib',
    'collections', 'itertools', 'functools', 'math', 'random', 'string',
    'hashlib', 'uuid', 'abc', 'dataclasses', 'enum', 'io', 're',
    'subprocess', 'threading', 'multiprocessing', 'asyncio', 'concurrent',
    'copy', 'pprint', 'textwrap', 'struct', 'csv', 'configparser',
    'argparse', 'shutil', 'tempfile', 'glob', 'fnmatch', 'traceback',
    'unittest', 'contextlib', 'warnings', 'signal', 'socket', 'http',
    'urllib', 'email', 'html', 'xml', 'base64', 'pickle', 'shelve',
    'sqlite3', 'gzip', 'zipfile', 'tarfile', 'zlib',
  ]);
  return stdlib.has(pkg);
}

/**
 * Extract credential requirements.
 */
function extractCredentials(toolType, wfJson, existingCreds) {
  const creds = [];
  const seen = new Set();

  // Use existing credentials_required from normalization
  for (const cred of existingCreds) {
    if (seen.has(cred)) continue;
    seen.add(cred);
    creds.push({
      name: cred,
      type: guessCredentialType(cred),
      required: true,
      service: cred.replace(/Auth$|Credentials?$|Api$|Key$/i, ''),
    });
  }

  // Tool-specific additional credential detection
  if (toolType === 'n8n') {
    const nodes = wfJson.nodes || [];
    for (const node of nodes) {
      if (node.credentials) {
        for (const [credName] of Object.entries(node.credentials)) {
          if (!seen.has(credName)) {
            seen.add(credName);
            creds.push({
              name: credName,
              type: guessCredentialType(credName),
              required: true,
              service: credName.replace(/Api$|Auth$|OAuth2$/i, ''),
            });
          }
        }
      }
    }
  }

  return creds;
}

function guessCredentialType(name) {
  const lower = name.toLowerCase();
  if (lower.includes('oauth')) return 'oauth2';
  if (lower.includes('api') || lower.includes('key')) return 'api_key';
  if (lower.includes('basic') || lower.includes('password')) return 'basic_auth';
  if (lower.includes('token')) return 'bearer_token';
  return 'api_key';
}

/**
 * Extract environment variables needed based on credentials.
 */
function extractEnvVars(toolType, credentials) {
  const envVars = [];

  for (const cred of credentials) {
    const envName = `${cred.service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
    envVars.push({
      name: envName,
      description: `API key for ${cred.service}`,
      required: cred.required,
    });
  }

  // Tool-specific env vars
  const toolEnvVars = {
    n8n: [{ name: 'N8N_HOST', description: 'n8n instance URL', required: true }],
    airflow: [{ name: 'AIRFLOW_HOME', description: 'Airflow home directory', required: true }],
    temporal: [{ name: 'TEMPORAL_HOST', description: 'Temporal server address', required: true }],
    prefect: [{ name: 'PREFECT_API_URL', description: 'Prefect server URL', required: false }],
    dagster: [{ name: 'DAGSTER_HOME', description: 'Dagster home directory', required: true }],
    argo: [{ name: 'ARGO_SERVER', description: 'Argo Workflows server URL', required: true }],
    comfyui: [{ name: 'COMFYUI_URL', description: 'ComfyUI server URL', required: true }],
    flowise: [{ name: 'FLOWISE_URL', description: 'Flowise server URL', required: true }],
    dify: [{ name: 'DIFY_API_URL', description: 'Dify instance URL', required: true }],
    tekton: [{ name: 'KUBECONFIG', description: 'Kubernetes config path', required: true }],
    'github-actions': [{ name: 'GITHUB_TOKEN', description: 'GitHub personal access token', required: true }],
    'home-assistant': [{ name: 'HASS_URL', description: 'Home Assistant URL', required: true }, { name: 'HASS_TOKEN', description: 'Long-lived access token', required: true }],
    mlflow: [{ name: 'MLFLOW_TRACKING_URI', description: 'MLflow tracking server URL', required: true }],
    dbt: [{ name: 'DBT_PROFILES_DIR', description: 'dbt profiles directory', required: false }],
    camunda: [{ name: 'CAMUNDA_URL', description: 'Camunda Platform URL', required: true }],
    'kafka-connect': [{ name: 'KAFKA_BOOTSTRAP_SERVERS', description: 'Kafka broker addresses', required: true }],
    camel: [{ name: 'CAMEL_MAIN_NAME', description: 'Camel application name', required: false }],
  };

  if (toolEnvVars[toolType]) {
    envVars.push(...toolEnvVars[toolType]);
  }

  return envVars;
}

/**
 * Extract service requirements.
 */
function extractServices(toolType, wfJson, toolMeta) {
  const services = [];

  const toolServices = {
    n8n: [{ name: 'n8n', version: '>=1.0' }],
    airflow: [{ name: 'Apache Airflow', version: '>=2.0' }],
    temporal: [{ name: 'Temporal Server', version: '>=1.20' }],
    prefect: [{ name: 'Prefect', version: '>=2.0' }],
    dagster: [{ name: 'Dagster', version: '>=1.0' }],
    comfyui: [{ name: 'ComfyUI', version: '>=latest' }],
    flowise: [{ name: 'Flowise', version: '>=1.0' }],
    activepieces: [{ name: 'Activepieces', version: '>=0.20' }],
    argo: [{ name: 'Argo Workflows', version: '>=3.0' }, { name: 'Kubernetes', version: '>=1.25' }],
    luigi: [{ name: 'Luigi', version: '>=3.0' }],
    dify: [{ name: 'Dify', version: '>=0.6' }],
    pipedream: [{ name: 'Pipedream', version: '>=latest' }],
    langgraph: [{ name: 'LangGraph', version: '>=0.1' }],
    tekton: [{ name: 'Tekton Pipelines', version: '>=0.50' }, { name: 'Kubernetes', version: '>=1.25' }],
    'github-actions': [{ name: 'GitHub Actions', version: 'latest' }],
    'home-assistant': [{ name: 'Home Assistant', version: '>=2024.1' }],
    mlflow: [{ name: 'MLflow', version: '>=2.0' }],
    dbt: [{ name: 'dbt-core', version: '>=1.5' }],
    camunda: [{ name: 'Camunda Platform', version: '>=8.0' }],
    'kafka-connect': [{ name: 'Apache Kafka', version: '>=3.0' }],
    camel: [{ name: 'Apache Camel', version: '>=4.0' }],
  };

  if (toolServices[toolType]) {
    services.push(...toolServices[toolType]);
  }

  // Detect database needs from code
  const code = wfJson.source_code || JSON.stringify(wfJson);
  if (code.includes('postgres') || code.includes('PostgreSQL')) {
    services.push({ name: 'PostgreSQL', version: '>=14' });
  }
  if (code.includes('redis') || code.includes('Redis')) {
    services.push({ name: 'Redis', version: '>=6.0' });
  }

  return services;
}

/**
 * Get minimum runtime requirements for a tool type.
 */
function getMinimumRequirements(toolType) {
  const reqs = {
    n8n: { tool_version: 'n8n >=1.0', runtime: 'Node.js >=18' },
    comfyui: { tool_version: 'ComfyUI latest', runtime: 'Python >=3.10' },
    dify: { tool_version: 'Dify >=0.6', runtime: 'Python >=3.10' },
    flowise: { tool_version: 'Flowise >=1.0', runtime: 'Node.js >=18' },
    pipedream: { tool_version: 'Pipedream latest', runtime: 'Node.js >=18' },
    argo: { tool_version: 'Argo Workflows >=3.0', runtime: 'Kubernetes >=1.25' },
    luigi: { tool_version: 'Luigi >=3.0', runtime: 'Python >=3.8' },
    temporal: { tool_version: 'Temporal SDK >=1.0', runtime: 'Python >=3.8' },
    airflow: { tool_version: 'Apache Airflow >=2.0', runtime: 'Python >=3.8' },
    prefect: { tool_version: 'Prefect >=2.0', runtime: 'Python >=3.9' },
    dagster: { tool_version: 'Dagster >=1.0', runtime: 'Python >=3.8' },
    langgraph: { tool_version: 'LangGraph >=0.1', runtime: 'Python >=3.9' },
    activepieces: { tool_version: 'Activepieces >=0.20', runtime: 'Node.js >=18' },
    tekton: { tool_version: 'Tekton Pipelines >=0.50', runtime: 'Kubernetes >=1.25' },
    'github-actions': { tool_version: 'GitHub Actions latest', runtime: 'Ubuntu/Windows/macOS runner' },
    'home-assistant': { tool_version: 'Home Assistant >=2024.1', runtime: 'Python >=3.11' },
    mlflow: { tool_version: 'MLflow >=2.0', runtime: 'Python >=3.8' },
    dbt: { tool_version: 'dbt-core >=1.5', runtime: 'Python >=3.8' },
    camunda: { tool_version: 'Camunda Platform >=8.0', runtime: 'Java >=17' },
    'kafka-connect': { tool_version: 'Kafka Connect >=3.0', runtime: 'Java >=11' },
    camel: { tool_version: 'Apache Camel >=4.0', runtime: 'Java >=17' },
  };
  return reqs[toolType] || { tool_version: 'unknown', runtime: 'unknown' };
}

/**
 * Estimate setup time in minutes based on bundle complexity.
 */
function estimateSetupTime(bundle) {
  let minutes = 5; // Base
  const pkg = bundle.package || {};
  const deps = pkg.dependencies || [];
  const creds = pkg.credentials || [];
  const services = pkg.services || [];

  minutes += Math.min(deps.length * 2, 20);
  minutes += creds.length * 5; // Each credential takes ~5 min to set up
  minutes += services.length * 3;

  return Math.min(minutes, 120);
}
