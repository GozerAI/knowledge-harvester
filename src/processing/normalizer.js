// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { randomUUID } from 'node:crypto';
import { generateWorkflowHash, generateContentHash } from '../utils/hash.js';
import {
  countConnections,
  detectTriggerType,
  extractCredentials,
  estimateComplexity,
  extractNameFromPath,
} from '../utils/helpers.js';

/**
 * Normalize a raw API response into the unified workflow schema.
 * @param {'n8n-community'|'github'|'reddit'} source
 * @param {object} rawData - Source-specific raw data
 * @returns {object} Normalized workflow object
 */
export function normalizeWorkflow(source, rawData) {
  switch (source) {
    case 'n8n-community':      return normalizeN8nCommunity(rawData);
    case 'github':             return normalizeGitHub(rawData);
    case 'reddit':             return normalizeReddit(rawData);
    case 'github-agents':      return normalizeAgentFramework(rawData);
    case 'github-zapier-make': return normalizeZapierMake(rawData);
    case 'activepieces':       return normalizeActivepieces(rawData);
    case 'windmill':           return normalizeWindmill(rawData);
    case 'temporal':           return normalizeCodeWorkflow(rawData, 'temporal');
    case 'airflow':            return normalizeCodeWorkflow(rawData, 'airflow');
    case 'node-red':           return normalizeNodeRed(rawData);
    case 'prefect':            return normalizeCodeWorkflow(rawData, 'prefect');
    case 'dagster':            return normalizeCodeWorkflow(rawData, 'dagster');
    case 'langgraph':          return normalizeCodeWorkflow(rawData, 'langgraph');
    case 'comfyui':            return normalizeComfyUI(rawData);
    case 'dify':               return normalizeDify(rawData);
    case 'flowise':            return normalizeFlowise(rawData);
    case 'pipedream':          return normalizePipedream(rawData);
    case 'argo':               return normalizeArgo(rawData);
    case 'luigi':              return normalizeLuigi(rawData);
    case 'tekton':             return normalizeTekton(rawData);
    case 'github-actions':     return normalizeGitHubActions(rawData);
    case 'home-assistant':     return normalizeHomeAssistant(rawData);
    case 'mlflow':             return normalizeCodeWorkflow(rawData, 'mlflow');
    case 'dbt':                return normalizeDbt(rawData);
    case 'camunda':            return normalizeCamunda(rawData);
    case 'kafka-connect':      return normalizeKafkaConnect(rawData);
    case 'camel':              return normalizeCamel(rawData);
    default: throw new Error(`Unknown source: ${source}`);
  }
}

/**
 * Shared metadata builder from a workflow JSON.
 */
function buildMetadata(workflowJson, extras = {}) {
  const nodes = workflowJson.nodes || [];
  return {
    node_types: [...new Set(nodes.map(n => n.type).filter(Boolean))],
    node_count: nodes.length,
    connection_count: countConnections(workflowJson),
    trigger_type: detectTriggerType(workflowJson),
    credentials_required: extractCredentials(workflowJson),
    has_code_node: nodes.some(n =>
      n.type === 'n8n-nodes-base.code' ||
      n.type === 'n8n-nodes-base.function'
    ),
    estimated_complexity: estimateComplexity(workflowJson),
    ...extras,
  };
}

/**
 * Normalize n8n Community template.
 * @param {object} data - The outer wrapper: response.workflow from /api/templates/workflows/{id}
 *   data.workflow = the inner n8n workflow definition (nodes, connections)
 */
function normalizeN8nCommunity(data) {
  const workflowJson = data.workflow; // inner workflow object with nodes/connections
  return {
    id: randomUUID(),
    hash: generateWorkflowHash(workflowJson),
    source: 'n8n-community',
    source_url: `https://n8n.io/workflows/${data.id}`,
    source_id: String(data.id),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: workflowJson,
    workflow_name: data.name || 'Untitled',
    original_description: data.description || '',
    author: {
      username: data.user?.username || 'unknown',
      profile_url: data.user?.username
        ? `https://n8n.io/creators/${data.user.username}`
        : null,
    },
    metadata: buildMetadata(workflowJson),
    quality: {
      score: 0,
      has_description: !!data.description,
      has_documentation: (data.description?.length || 0) > 200,
      is_complete: true,
      validation_status: 'valid',
    },
  };
}

/**
 * Normalize GitHub search result + fetched workflow JSON.
 * @param {object} data - { searchResult, workflowJson }
 */
function normalizeGitHub(data) {
  const { searchResult, workflowJson } = data;
  return {
    id: randomUUID(),
    hash: generateWorkflowHash(workflowJson),
    source: 'github',
    source_url: searchResult.html_url,
    source_id: searchResult.sha,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: workflowJson,
    workflow_name: workflowJson.name || extractNameFromPath(searchResult.path),
    original_description: '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: buildMetadata(workflowJson, {
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    }),
    quality: {
      score: 0,
      has_description: false,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
  };
}

/**
 * Normalize Reddit post + extracted workflow JSON.
 * @param {object} data - { post, workflowJson, context }
 */
function normalizeReddit(data) {
  const { post, workflowJson, context } = data;
  return {
    id: randomUUID(),
    hash: generateWorkflowHash(workflowJson),
    source: 'reddit',
    source_url: `https://reddit.com${post.permalink}`,
    source_id: `reddit-${post.id}-${context}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: workflowJson,
    workflow_name: workflowJson.name || 'Untitled (Reddit)',
    original_description: post.title || '',
    author: {
      username: post.author || 'unknown',
      profile_url: post.author ? `https://reddit.com/u/${post.author}` : null,
    },
    metadata: buildMetadata(workflowJson, {
      reddit_score: post.score || 0,
      reddit_comments: post.num_comments || 0,
    }),
    quality: {
      score: 0,
      has_description: !!post.title,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
  };
}

// ─── AI Agent Framework Normalizer (LangChain, CrewAI, AutoGen) ───

/**
 * Extract components/tools from Python agent code.
 */
function extractAgentComponents(content, framework) {
  const components = new Set();

  if (framework === 'langchain') {
    // Extract tool names from load_tools, Tool(), etc.
    const toolMatches = content.match(/Tool\(\s*name\s*=\s*["']([^"']+)["']/g) || [];
    toolMatches.forEach(m => {
      const name = m.match(/name\s*=\s*["']([^"']+)["']/)?.[1];
      if (name) components.add(name);
    });
    // Extract chain types
    const chainMatches = content.match(/(?:from\s+langchain\w*\s+import\s+)(\w+)/g) || [];
    chainMatches.forEach(m => {
      const cls = m.split('import').pop()?.trim();
      if (cls) components.add(cls);
    });
    // Extract model providers
    if (content.includes('ChatOpenAI') || content.includes('OpenAI')) components.add('OpenAI');
    if (content.includes('ChatAnthropic') || content.includes('Anthropic')) components.add('Anthropic');
    if (content.includes('ChatOllama') || content.includes('Ollama')) components.add('Ollama');
  } else if (framework === 'crewai') {
    // Extract agent roles
    const agentMatches = content.match(/Agent\(\s*[\s\S]*?role\s*=\s*["']([^"']+)["']/g) || [];
    agentMatches.forEach(m => {
      const role = m.match(/role\s*=\s*["']([^"']+)["']/)?.[1];
      if (role) components.add(`agent:${role}`);
    });
    // Extract task names
    const taskMatches = content.match(/Task\(\s*[\s\S]*?description\s*=\s*["']([^"']{1,60})/g) || [];
    taskMatches.forEach(m => {
      const desc = m.match(/description\s*=\s*["']([^"']{1,60})/)?.[1];
      if (desc) components.add(`task:${desc.slice(0, 40)}`);
    });
  } else if (framework === 'autogen') {
    // Extract agent types
    const agentMatches = content.match(/(\w+Agent)\(/g) || [];
    agentMatches.forEach(m => {
      const name = m.replace('(', '');
      components.add(name);
    });
  }

  return [...components];
}

/**
 * Detect the model provider from agent code.
 */
function detectModelProvider(content) {
  if (content.includes('openai') || content.includes('OpenAI') || content.includes('gpt-')) return 'openai';
  if (content.includes('anthropic') || content.includes('Anthropic') || content.includes('claude')) return 'anthropic';
  if (content.includes('ollama') || content.includes('Ollama')) return 'ollama';
  if (content.includes('gemini') || content.includes('Gemini')) return 'google';
  if (content.includes('huggingface') || content.includes('HuggingFace')) return 'huggingface';
  return 'unknown';
}

/**
 * Estimate complexity for agent frameworks.
 */
function estimateAgentComplexity(content, components) {
  let score = 0;
  const lines = content.split('\n').length;
  if (lines > 50) score++;
  if (lines > 150) score++;
  if (components.length > 3) score++;
  if (content.includes('class ')) score++;
  if (content.includes('async ') || content.includes('await ')) score++;
  if (score >= 3) return 'complex';
  if (score >= 1) return 'moderate';
  return 'simple';
}

/**
 * Normalize AI agent framework code from GitHub.
 * @param {object} data - { searchResult, content, framework, filename }
 */
function normalizeAgentFramework(data) {
  const { searchResult, content, framework, filename } = data;
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const components = extractAgentComponents(contentStr, framework);
  const isYaml = filename?.endsWith('.yaml') || filename?.endsWith('.yml');

  return {
    id: randomUUID(),
    hash: generateContentHash(content, framework),
    source: 'github-agents',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-agent-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: typeof content === 'string' ? { source_code: content, filename } : content,
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: components,
      node_count: components.length,
      connection_count: 0,
      trigger_type: 'programmatic',
      credentials_required: [],
      has_code_node: true,
      estimated_complexity: estimateAgentComplexity(contentStr, components),
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    // Multi-tool fields
    tool_type: framework,
    tool_metadata: {
      framework,
      language: isYaml ? 'yaml' : 'python',
      model_provider: detectModelProvider(contentStr),
      components,
    },
    language: isYaml ? 'yaml' : 'python',
  };
}

// ─── Zapier / Make / IFTTT Normalizer ───

/**
 * Extract app names from Zapier/Make/IFTTT configs.
 */
function extractApps(config, toolType) {
  const apps = new Set();

  if (toolType === 'zapier') {
    // Zapier: triggers[], actions[], searches[]
    for (const step of (config.triggers || [])) {
      if (step.app || step.app_name) apps.add(step.app || step.app_name);
    }
    for (const step of (config.actions || [])) {
      if (step.app || step.app_name) apps.add(step.app || step.app_name);
    }
    for (const step of (config.searches || [])) {
      if (step.app || step.app_name) apps.add(step.app || step.app_name);
    }
    // Also check steps[] if present
    for (const step of (config.steps || [])) {
      if (step.app) apps.add(step.app);
    }
  } else if (toolType === 'make') {
    // Make: modules[] or scenario.modules[]
    const modules = config.modules || config.scenario?.modules || [];
    for (const mod of modules) {
      if (mod.module) apps.add(mod.module.split(':')[0]); // "google:sheets" → "google"
      if (mod.type) apps.add(mod.type);
    }
  } else if (toolType === 'ifttt') {
    // IFTTT: trigger.service, actions[].service
    if (config.trigger?.service) apps.add(config.trigger.service);
    for (const action of (config.actions || [])) {
      if (action.service) apps.add(action.service);
    }
  }

  return [...apps];
}

/**
 * Normalize Zapier/Make/IFTTT configuration from GitHub.
 * @param {object} data - { searchResult, content, toolType, filename }
 */
function normalizeZapierMake(data) {
  const { searchResult, content, toolType, filename } = data;
  const apps = extractApps(content, toolType);

  // Count steps
  let stepCount = 0;
  if (toolType === 'zapier') {
    stepCount = (content.triggers?.length || 0) + (content.actions?.length || 0) + (content.steps?.length || 0);
  } else if (toolType === 'make') {
    stepCount = (content.modules || content.scenario?.modules || []).length;
  } else if (toolType === 'ifttt') {
    stepCount = 1 + (content.actions?.length || 0); // trigger + actions
  }

  const complexity = stepCount > 5 ? 'complex' : stepCount > 2 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, toolType),
    source: 'github-zapier-make',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-${toolType}-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: content,
    workflow_name: content.name || content.title || extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: content.description || searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: apps,
      node_count: stepCount,
      connection_count: Math.max(0, stepCount - 1),
      trigger_type: toolType === 'ifttt' ? 'event' : 'webhook',
      credentials_required: apps, // Each app likely needs credentials
      has_code_node: false,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!content.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    // Multi-tool fields
    tool_type: toolType,
    tool_metadata: {
      trigger_app: apps[0] || null,
      action_apps: apps.slice(1),
      step_count: stepCount,
      apps,
    },
    language: 'json',
  };
}

// ─── Activepieces Template Normalizer ───

/**
 * Extract pieces (apps) from an Activepieces template.
 */
function extractActivepiecesPieces(template) {
  const pieces = new Set();
  const flow = template.template || template;

  // Extract from pieces array
  if (Array.isArray(flow.pieces)) {
    flow.pieces.forEach(p => {
      if (typeof p === 'string') pieces.add(p);
      else if (p.name || p.pieceName) pieces.add(p.name || p.pieceName);
    });
  }

  // Walk trigger/action tree for piece names
  const walkStep = (step) => {
    if (!step) return;
    if (step.pieceName) pieces.add(step.pieceName);
    if (step.type?.includes('PIECE')) {
      const name = step.settings?.pieceName || step.pieceName;
      if (name) pieces.add(name);
    }
    // Recurse into branches/next
    if (step.nextAction) walkStep(step.nextAction);
    if (step.onSuccessAction) walkStep(step.onSuccessAction);
    if (step.onFailureAction) walkStep(step.onFailureAction);
    if (step.firstLoopAction) walkStep(step.firstLoopAction);
    // Branch conditions
    if (Array.isArray(step.children)) {
      step.children.forEach(c => walkStep(c));
    }
  };

  walkStep(flow.trigger);
  if (Array.isArray(flow.steps)) flow.steps.forEach(s => walkStep(s));
  if (Array.isArray(flow.actions)) flow.actions.forEach(a => walkStep(a));

  return [...pieces];
}

/**
 * Count steps in an Activepieces flow.
 */
function countActivepiecesSteps(template) {
  const flow = template.template || template;
  let count = 0;

  const walkStep = (step) => {
    if (!step) return;
    count++;
    if (step.nextAction) walkStep(step.nextAction);
    if (step.onSuccessAction) walkStep(step.onSuccessAction);
    if (step.onFailureAction) walkStep(step.onFailureAction);
    if (step.firstLoopAction) walkStep(step.firstLoopAction);
    if (Array.isArray(step.children)) step.children.forEach(c => walkStep(c));
  };

  walkStep(flow.trigger);
  if (Array.isArray(flow.steps)) flow.steps.forEach(s => walkStep(s));
  if (Array.isArray(flow.actions)) flow.actions.forEach(a => walkStep(a));

  return count;
}

/**
 * Normalize an Activepieces template from the gallery API.
 * @param {object} data - { template }
 */
function normalizeActivepieces(data) {
  const { template } = data;
  const flow = template.template || template;
  const pieces = extractActivepiecesPieces(template);
  const stepCount = countActivepiecesSteps(template);
  const complexity = stepCount > 8 ? 'complex' : stepCount > 3 ? 'moderate' : 'simple';

  const name = template.name || template.displayName || flow.displayName || 'Untitled';
  const description = template.description || template.blogUrl || '';
  const templateId = template.id || name;

  return {
    id: randomUUID(),
    hash: generateContentHash(flow, 'activepieces'),
    source: 'activepieces',
    source_url: template.blogUrl || `https://www.activepieces.com/pieces`,
    source_id: `ap-${templateId}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: flow,
    workflow_name: name,
    original_description: description,
    author: {
      username: template.user?.username || template.author || 'activepieces',
      profile_url: null,
    },
    metadata: {
      node_types: pieces,
      node_count: stepCount,
      connection_count: Math.max(0, stepCount - 1),
      trigger_type: flow.trigger?.type?.includes('WEBHOOK') ? 'webhook'
        : flow.trigger?.type?.includes('SCHEDULE') ? 'cron'
        : 'event',
      credentials_required: pieces, // each piece typically needs auth
      has_code_node: pieces.some(p => p.includes('code') || p.includes('script')),
      estimated_complexity: complexity,
    },
    quality: {
      score: 0,
      has_description: !!description,
      has_documentation: (description?.length || 0) > 200,
      is_complete: true,
      validation_status: 'valid',
    },
    // Multi-tool fields
    tool_type: 'activepieces',
    tool_metadata: {
      pieces,
      step_count: stepCount,
      trigger_type: flow.trigger?.type || 'unknown',
    },
    language: 'json',
  };
}

// ─── Windmill OpenFlow Normalizer ───

/**
 * Extract modules/steps from Windmill content.
 */
function extractWindmillComponents(content, lang) {
  const components = new Set();

  if (lang === 'json') {
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      // OpenFlow modules
      if (Array.isArray(parsed.modules)) {
        parsed.modules.forEach(m => {
          if (m.summary) components.add(m.summary);
          if (m.value?.type) components.add(m.value.type);
        });
      }
      if (Array.isArray(parsed.value?.modules)) {
        parsed.value.modules.forEach(m => {
          if (m.summary) components.add(m.summary);
          if (m.value?.type) components.add(m.value.type);
        });
      }
    } catch { /* non-JSON content */ }
  } else if (lang === 'python') {
    // Extract wmill resource/variable references
    const refs = content.match(/wmill\.get_resource\(["']([^"']+)["']\)/g) || [];
    refs.forEach(r => {
      const name = r.match(/["']([^"']+)["']/)?.[1];
      if (name) components.add(name);
    });
    // Extract function definitions
    const funcs = content.match(/def\s+(\w+)/g) || [];
    funcs.forEach(f => components.add(f.replace('def ', '')));
  } else if (lang === 'typescript') {
    const funcs = content.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g) || [];
    funcs.forEach(f => {
      const name = f.match(/function\s+(\w+)/)?.[1];
      if (name) components.add(name);
    });
  }

  return [...components];
}

/**
 * Normalize Windmill flow/script from GitHub.
 * @param {object} data - { searchResult, content, lang, filename }
 */
function normalizeWindmill(data) {
  const { searchResult, content, lang, filename } = data;
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const components = extractWindmillComponents(content, lang);

  // Try to extract name from JSON content
  let name;
  if (lang === 'json') {
    try {
      const parsed = JSON.parse(contentStr);
      name = parsed.summary || parsed.description || parsed.path;
    } catch { /* ignore */ }
  }
  name = name || extractNameFromPath(searchResult.path || filename || 'untitled');

  // Estimate complexity
  const lines = contentStr.split('\n').length;
  const complexity = lines > 200 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'windmill'),
    source: 'windmill',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-windmill-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: typeof content === 'string' ? { source_code: content, filename } : content,
    workflow_name: name,
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: components,
      node_count: components.length,
      connection_count: 0,
      trigger_type: 'programmatic',
      credentials_required: [],
      has_code_node: true,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    // Multi-tool fields
    tool_type: 'windmill',
    tool_metadata: {
      language: lang,
      components,
      is_flow: lang === 'json',
    },
    language: lang,
  };
}

// ─── Generic Code Workflow Normalizer (Temporal, Airflow) ───

/**
 * Extract components from Temporal workflow code.
 */
function extractTemporalComponents(content, lang) {
  const components = new Set();

  // Extract workflow/activity function names
  if (lang === 'python') {
    // @workflow.defn classes
    const classes = content.match(/class\s+(\w+)/g) || [];
    classes.forEach(c => components.add(c.replace('class ', '')));
    // @activity.defn functions
    const funcs = content.match(/async\s+def\s+(\w+)|def\s+(\w+)/g) || [];
    funcs.forEach(f => {
      const name = f.match(/def\s+(\w+)/)?.[1];
      if (name && name !== '__init__') components.add(name);
    });
  } else if (lang === 'typescript') {
    const funcs = content.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g) || [];
    funcs.forEach(f => {
      const name = f.match(/function\s+(\w+)/)?.[1];
      if (name) components.add(name);
    });
  } else if (lang === 'go') {
    const funcs = content.match(/func\s+(\w+)/g) || [];
    funcs.forEach(f => components.add(f.replace('func ', '')));
  } else if (lang === 'java') {
    const methods = content.match(/(?:public|private)\s+\w+\s+(\w+)\s*\(/g) || [];
    methods.forEach(m => {
      const name = m.match(/(\w+)\s*\(/)?.[1];
      if (name) components.add(name);
    });
  }

  return [...components];
}

/**
 * Extract components from Airflow DAG code.
 */
function extractAirflowComponents(content) {
  const components = new Set();

  // Extract operator types
  const operators = content.match(/(\w+Operator|Sensor|Transfer)\s*\(/g) || [];
  operators.forEach(o => components.add(o.replace('(', '')));

  // Extract task IDs
  const taskIds = content.match(/task_id\s*=\s*["']([^"']+)["']/g) || [];
  taskIds.forEach(t => {
    const id = t.match(/["']([^"']+)["']/)?.[1];
    if (id) components.add(`task:${id}`);
  });

  // Extract provider connections
  const conns = content.match(/conn_id\s*=\s*["']([^"']+)["']/g) || [];
  conns.forEach(c => {
    const id = c.match(/["']([^"']+)["']/)?.[1];
    if (id) components.add(`conn:${id}`);
  });

  // Detect schedule
  if (content.includes('schedule_interval') || content.includes('schedule=')) {
    components.add('scheduled');
  }

  return [...components];
}

/**
 * Normalize a code-based workflow from GitHub.
 * Shared function for Temporal, Airflow, Prefect, Dagster, and LangGraph.
 *
 * @param {object} data - { searchResult, content, lang?, filename }
 * @param {'temporal'|'airflow'|'prefect'|'dagster'|'langgraph'} toolType
 */
function normalizeCodeWorkflow(data, toolType) {
  const { searchResult, content, filename } = data;
  const lang = data.lang || 'python';
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

  // Route to tool-specific component extractor
  const COMPONENT_EXTRACTORS = {
    airflow:   (c) => extractAirflowComponents(c),
    temporal:  (c, l) => extractTemporalComponents(c, l),
    prefect:   (c) => extractPrefectComponents(c),
    dagster:   (c) => extractDagsterComponents(c),
    langgraph: (c, l) => extractLangGraphComponents(c, l),
    mlflow:    (c) => extractMlflowComponents(c),
  };
  const extractor = COMPONENT_EXTRACTORS[toolType] || COMPONENT_EXTRACTORS.temporal;
  const components = extractor(contentStr, lang);

  // Estimate complexity
  const lines = contentStr.split('\n').length;
  let complexityScore = 0;
  if (lines > 50) complexityScore++;
  if (lines > 150) complexityScore++;
  if (components.length > 5) complexityScore++;
  if (contentStr.includes('class ')) complexityScore++;
  if (contentStr.includes('async ') || contentStr.includes('await ')) complexityScore++;
  const complexity = complexityScore >= 3 ? 'complex' : complexityScore >= 1 ? 'moderate' : 'simple';

  // Detect trigger type
  let triggerType = 'programmatic';
  if (toolType === 'airflow') {
    if (contentStr.includes('schedule_interval') || contentStr.includes('schedule=')) {
      triggerType = 'cron';
    } else if (contentStr.includes('ExternalTaskSensor') || contentStr.includes('HttpSensor')) {
      triggerType = 'event';
    }
  } else if (toolType === 'temporal') {
    if (contentStr.includes('schedule') || contentStr.includes('cron_schedule')) {
      triggerType = 'cron';
    } else if (contentStr.includes('signal') || contentStr.includes('defineSignal')) {
      triggerType = 'event';
    }
  } else if (toolType === 'prefect') {
    if (contentStr.includes('schedule') || contentStr.includes('CronSchedule') || contentStr.includes('IntervalSchedule')) {
      triggerType = 'cron';
    } else if (contentStr.includes('.serve(')) {
      triggerType = 'event'; // Prefect serve = long-running listener
    }
  } else if (toolType === 'dagster') {
    if (contentStr.includes('@schedule')) {
      triggerType = 'cron';
    } else if (contentStr.includes('@sensor')) {
      triggerType = 'event';
    }
  }
  // langgraph stays 'programmatic'

  // Build tool_metadata per tool type
  let toolMetadata = { language: lang, components };
  if (toolType === 'airflow') {
    toolMetadata.operators = components.filter(c => c.includes('Operator') || c.includes('Sensor'));
    toolMetadata.task_ids = components.filter(c => c.startsWith('task:')).map(c => c.slice(5));
  } else if (toolType === 'prefect') {
    toolMetadata.flows = components.filter(c => c.startsWith('flow:'));
    toolMetadata.tasks = components.filter(c => c.startsWith('task:'));
  } else if (toolType === 'dagster') {
    toolMetadata.assets = components.filter(c => c.startsWith('asset:'));
    toolMetadata.ops = components.filter(c => c.startsWith('op:'));
    toolMetadata.jobs = components.filter(c => c.startsWith('job:'));
  } else if (toolType === 'langgraph') {
    toolMetadata.nodes = components.filter(c => c.startsWith('node:'));
    toolMetadata.edges = components.filter(c => c.startsWith('edge:'));
    toolMetadata.has_tools = components.some(c => c.includes('ToolNode') || c.includes('tool'));
    toolMetadata.has_checkpointer = components.some(c => c.includes('checkpoint'));
  } else if (toolType === 'mlflow') {
    toolMetadata.experiments = components.filter(c => c.startsWith('experiment:'));
    toolMetadata.runs = components.filter(c => c.startsWith('run:'));
    toolMetadata.models = components.filter(c => c.startsWith('model:'));
  } else {
    // temporal / default
    toolMetadata.workflows = components.filter(c => c[0] === c[0]?.toUpperCase());
    toolMetadata.activities = components.filter(c => c[0] === c[0]?.toLowerCase());
  }

  return {
    id: randomUUID(),
    hash: generateContentHash(content, toolType),
    source: toolType,
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-${toolType}-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: content, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: components,
      node_count: components.length,
      connection_count: 0,
      trigger_type: triggerType,
      credentials_required: [],
      has_code_node: true,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    // Multi-tool fields
    tool_type: toolType,
    tool_metadata: toolMetadata,
    language: lang,
  };
}

// ─── Node-RED Flow Normalizer ───

/**
 * Normalize a Node-RED flow from the flow library.
 * @param {object} data - { flowSummary, flowDetail }
 */
function normalizeNodeRed(data) {
  const { flowSummary, flowDetail } = data;
  const nodes = flowDetail.nodes || flowDetail.flow?.nodes || [];

  // Extract real node types (exclude tabs, comments, subflows)
  const nodeTypes = new Set();
  let tabCount = 0;
  let subflowCount = 0;
  let wireCount = 0;
  let hasFunctionNode = false;

  for (const node of nodes) {
    if (!node.type) continue;
    if (node.type === 'tab') { tabCount++; continue; }
    if (node.type === 'comment') continue;
    if (node.type === 'subflow') { subflowCount++; continue; }
    if (node.type.startsWith('subflow:')) { subflowCount++; }

    nodeTypes.add(node.type);

    // Count wires (connections)
    if (Array.isArray(node.wires)) {
      for (const portWires of node.wires) {
        if (Array.isArray(portWires)) wireCount += portWires.length;
      }
    }

    // Detect function/template nodes
    if (node.type === 'function' || node.type === 'template') {
      hasFunctionNode = true;
    }
  }

  const realNodes = nodes.filter(
    n => n.type && n.type !== 'tab' && n.type !== 'comment' && n.type !== 'subflow'
  );

  // Detect trigger type
  const types = [...nodeTypes];
  let triggerType = 'event';
  if (types.some(t => t === 'http in' || t === 'http-in' || t === 'websocket-listener')) {
    triggerType = 'webhook';
  } else if (types.some(t => t === 'inject')) {
    // Check if the inject node has a cron/interval config
    const injectNodes = nodes.filter(n => n.type === 'inject');
    if (injectNodes.some(n => n.repeat || n.crontab)) {
      triggerType = 'cron';
    }
  } else if (types.some(t => t.includes('mqtt') || t.includes('tcp') || t.includes('udp'))) {
    triggerType = 'event';
  }

  // Complexity
  const complexity = realNodes.length > 15 ? 'complex'
    : realNodes.length > 5 ? 'moderate' : 'simple';

  const name = flowSummary.name || flowDetail.name || flowDetail.label || 'Untitled Flow';
  const description = flowSummary.description || flowDetail.description || '';
  const flowId = flowSummary._id || flowDetail._id || name;

  return {
    id: randomUUID(),
    hash: generateContentHash(nodes, 'node-red'),
    source: 'node-red',
    source_url: `https://flows.nodered.org/flow/${flowId}`,
    source_id: `nodered-${flowId}`,
    discovered_at: new Date().toISOString(),
    updated_at: flowSummary.updated_at || new Date().toISOString(),
    workflow_json: { nodes, name, description },
    workflow_name: name,
    original_description: description,
    author: {
      username: flowSummary.author?.name || flowDetail.author?.name || 'unknown',
      profile_url: null,
    },
    metadata: {
      node_types: types,
      node_count: realNodes.length,
      connection_count: wireCount,
      trigger_type: triggerType,
      credentials_required: [],
      has_code_node: hasFunctionNode,
      estimated_complexity: complexity,
    },
    quality: {
      score: 0,
      has_description: description.length > 0,
      has_documentation: description.length > 200,
      is_complete: true,
      validation_status: 'valid',
    },
    // Multi-tool fields
    tool_type: 'node-red',
    tool_metadata: {
      node_types: types,
      tab_count: tabCount,
      subflow_count: subflowCount,
      wire_count: wireCount,
      weekly_downloads: flowSummary.downloads?.week || 0,
      rating: flowSummary.rating?.score || 0,
    },
    language: 'json',
  };
}

// ─── Prefect Component Extractor ───

/**
 * Extract components from Prefect flow/task code.
 */
function extractPrefectComponents(content) {
  const components = new Set();

  // Extract @flow decorated functions
  const flowFuncs = content.match(/@flow[\s\S]*?\ndef\s+(\w+)/g) || [];
  flowFuncs.forEach(f => {
    const name = f.match(/def\s+(\w+)/)?.[1];
    if (name) components.add(`flow:${name}`);
  });

  // Extract @task decorated functions
  const taskFuncs = content.match(/@task[\s\S]*?\ndef\s+(\w+)/g) || [];
  taskFuncs.forEach(f => {
    const name = f.match(/def\s+(\w+)/)?.[1];
    if (name) components.add(`task:${name}`);
  });

  // Detect subflow calls (.submit(), .map())
  if (content.includes('.submit(')) components.add('pattern:submit');
  if (content.includes('.map(')) components.add('pattern:map');

  // Detect infrastructure
  if (content.includes('DockerContainer')) components.add('infra:docker');
  if (content.includes('KubernetesJob')) components.add('infra:kubernetes');
  if (content.includes('Process(')) components.add('infra:process');

  // Detect integrations
  const integrations = content.match(/from prefect_(\w+)/g) || [];
  integrations.forEach(i => {
    const name = i.match(/from prefect_(\w+)/)?.[1];
    if (name) components.add(`integration:${name}`);
  });

  return [...components];
}

// ─── Dagster Component Extractor ───

/**
 * Extract components from Dagster definition code.
 */
function extractDagsterComponents(content) {
  const components = new Set();

  // Extract @asset decorated functions
  const assets = content.match(/@asset[\s\S]*?\ndef\s+(\w+)/g) || [];
  assets.forEach(a => {
    const name = a.match(/def\s+(\w+)/)?.[1];
    if (name) components.add(`asset:${name}`);
  });

  // Extract @op decorated functions
  const ops = content.match(/@op[\s\S]*?\ndef\s+(\w+)/g) || [];
  ops.forEach(o => {
    const name = o.match(/def\s+(\w+)/)?.[1];
    if (name) components.add(`op:${name}`);
  });

  // Extract @job decorated functions
  const jobs = content.match(/@job[\s\S]*?\ndef\s+(\w+)/g) || [];
  jobs.forEach(j => {
    const name = j.match(/def\s+(\w+)/)?.[1];
    if (name) components.add(`job:${name}`);
  });

  // Extract @graph decorated functions
  const graphs = content.match(/@graph[\s\S]*?\ndef\s+(\w+)/g) || [];
  graphs.forEach(g => {
    const name = g.match(/def\s+(\w+)/)?.[1];
    if (name) components.add(`graph:${name}`);
  });

  // Detect @schedule / @sensor
  if (content.includes('@schedule')) components.add('trigger:schedule');
  if (content.includes('@sensor')) components.add('trigger:sensor');

  // Detect IO managers
  const ioManagers = content.match(/(\w+IoManager)/g) || [];
  ioManagers.forEach(m => components.add(`io_manager:${m}`));

  // Detect resources
  if (content.includes('ConfigurableResource')) components.add('pattern:configurable_resource');
  if (content.includes('Definitions(')) components.add('pattern:definitions');

  // Detect integrations
  const integrations = content.match(/from dagster_(\w+)/g) || [];
  integrations.forEach(i => {
    const name = i.match(/from dagster_(\w+)/)?.[1];
    if (name) components.add(`integration:${name}`);
  });

  return [...components];
}

// ─── LangGraph Component Extractor ───

/**
 * Extract components from LangGraph graph definition code.
 */
function extractLangGraphComponents(content, lang) {
  const components = new Set();

  if (lang === 'python') {
    // Extract add_node("name", ...) calls
    const nodeAdds = content.match(/\.add_node\(\s*["']([^"']+)["']/g) || [];
    nodeAdds.forEach(n => {
      const name = n.match(/["']([^"']+)["']/)?.[1];
      if (name) components.add(`node:${name}`);
    });

    // Extract add_edge("from", "to") calls
    const edges = content.match(/\.add_edge\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g) || [];
    edges.forEach(e => {
      const match = e.match(/["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
      if (match) components.add(`edge:${match[1]}->${match[2]}`);
    });

    // Detect conditional edges
    if (content.includes('add_conditional_edges')) {
      components.add('pattern:conditional_edges');
    }

    // Detect graph types
    if (content.includes('StateGraph')) components.add('graph:StateGraph');
    if (content.includes('MessageGraph')) components.add('graph:MessageGraph');

    // Detect prebuilt components
    if (content.includes('ToolNode')) components.add('prebuilt:ToolNode');
    if (content.includes('create_react_agent')) components.add('prebuilt:react_agent');

    // Detect checkpointing
    if (content.includes('checkpoint') || content.includes('MemorySaver') || content.includes('SqliteSaver')) {
      components.add('feature:checkpoint');
    }

    // Detect human-in-the-loop
    if (content.includes('interrupt_before') || content.includes('interrupt_after')) {
      components.add('feature:human_in_loop');
    }
  } else if (lang === 'typescript') {
    // Extract addNode("name", ...) calls
    const nodeAdds = content.match(/\.addNode\(\s*["']([^"']+)["']/g) || [];
    nodeAdds.forEach(n => {
      const name = n.match(/["']([^"']+)["']/)?.[1];
      if (name) components.add(`node:${name}`);
    });

    // Extract addEdge calls
    const edges = content.match(/\.addEdge\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g) || [];
    edges.forEach(e => {
      const match = e.match(/["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
      if (match) components.add(`edge:${match[1]}->${match[2]}`);
    });

    // Detect conditional edges
    if (content.includes('addConditionalEdges')) {
      components.add('pattern:conditional_edges');
    }

    // Detect graph types
    if (content.includes('StateGraph')) components.add('graph:StateGraph');

    // Detect tool node / checkpointer
    if (content.includes('ToolNode')) components.add('prebuilt:ToolNode');
    if (content.includes('MemorySaver') || content.includes('checkpoint')) {
      components.add('feature:checkpoint');
    }
  }

  return [...components];
}

// ─── ComfyUI Component Extractor ───

/**
 * Extract class_type values from ComfyUI workflow JSON.
 * @param {object} content - Parsed ComfyUI workflow JSON
 * @returns {string[]} Unique class_type values
 */
function extractComfyUIComponents(content) {
  const classTypes = new Set();
  if (content && typeof content === 'object') {
    for (const key of Object.keys(content)) {
      const node = content[key];
      if (node?.class_type) classTypes.add(node.class_type);
    }
  }
  return [...classTypes];
}

// ─── Dify Component Extractor ───

/**
 * Extract model/tool references from Dify YAML config string.
 * @param {string} content - YAML string of Dify app config
 * @returns {string[]} Extracted model and tool references
 */
function extractDifyComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract model provider references
  const modelProviders = contentStr.match(/provider:\s*["']?(\w[\w.-]*)["']?/g) || [];
  modelProviders.forEach(m => {
    const name = m.match(/provider:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`model:${name}`);
  });

  // Extract model names
  const modelNames = contentStr.match(/model:\s*["']?(\w[\w.-]*)["']?/g) || [];
  modelNames.forEach(m => {
    const name = m.match(/model:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`model:${name}`);
  });

  // Extract tool references
  const tools = contentStr.match(/tool_label:\s*["']?([^"'\n]+)["']?/g) || [];
  tools.forEach(t => {
    const name = t.match(/tool_label:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim();
    if (name) components.add(`tool:${name}`);
  });

  // Extract tool provider names
  const toolProviders = contentStr.match(/provider_id:\s*["']?(\w[\w.-]*)["']?/g) || [];
  toolProviders.forEach(t => {
    const name = t.match(/provider_id:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`tool:${name}`);
  });

  return [...components];
}

// ─── Flowise Component Extractor ───

/**
 * Extract node names from Flowise chatflow JSON.
 * @param {object} content - Parsed Flowise chatflow JSON
 * @returns {string[]} Node data.name values
 */
function extractFlowiseComponents(content) {
  const nodeNames = new Set();
  const nodes = content?.nodes || [];
  for (const node of nodes) {
    if (node?.data?.name) nodeNames.add(node.data.name);
    if (node?.data?.label) nodeNames.add(node.data.label);
  }
  return [...nodeNames];
}

// ─── Pipedream Component Extractor ───

/**
 * Extract defineComponent names, step names, and app integrations from Pipedream JS.
 * @param {string} content - JavaScript source code
 * @returns {string[]} Extracted component/app references
 */
function extractPipedreamComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract defineComponent references
  const compMatches = contentStr.match(/defineComponent\(\s*\{[\s\S]*?name:\s*["']([^"']+)["']/g) || [];
  compMatches.forEach(m => {
    const name = m.match(/name:\s*["']([^"']+)["']/)?.[1];
    if (name) components.add(`component:${name}`);
  });

  // Extract step names from steps.*
  const stepMatches = contentStr.match(/steps\.(\w+)/g) || [];
  stepMatches.forEach(m => {
    const name = m.replace('steps.', '');
    if (name) components.add(`step:${name}`);
  });

  // Extract app integrations (e.g., @pipedream/platform, app: "slack")
  const appMatches = contentStr.match(/app:\s*["']([^"']+)["']/g) || [];
  appMatches.forEach(m => {
    const name = m.match(/app:\s*["']([^"']+)["']/)?.[1];
    if (name) components.add(`app:${name}`);
  });

  // Extract this.$auth references
  const authMatches = contentStr.match(/this\.\$auth/g) || [];
  if (authMatches.length > 0) components.add('feature:auth');

  return [...components];
}

// ─── Argo Component Extractor ───

/**
 * Extract template names, container images, and DAG task names from Argo YAML.
 * @param {string} content - YAML string of Argo Workflow
 * @returns {string[]} Extracted template/image/DAG references
 */
function extractArgoComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract template names
  const templateMatches = contentStr.match(/- name:\s*["']?(\w[\w.-]*)["']?/g) || [];
  templateMatches.forEach(m => {
    const name = m.match(/- name:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`template:${name}`);
  });

  // Extract container images
  const imageMatches = contentStr.match(/image:\s*["']?([^\s"'\n]+)["']?/g) || [];
  imageMatches.forEach(m => {
    const image = m.match(/image:\s*["']?([^\s"'\n]+)["']?/)?.[1];
    if (image) components.add(`image:${image}`);
  });

  // Extract DAG task names
  const dagTaskMatches = contentStr.match(/- name:\s*["']?(\w[\w.-]*)["']?\s*\n\s*(?:dependencies|template)/g) || [];
  dagTaskMatches.forEach(m => {
    const name = m.match(/- name:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`dag-task:${name}`);
  });

  // Detect workflow kind
  if (contentStr.includes('CronWorkflow')) components.add('kind:CronWorkflow');
  if (contentStr.match(/kind:\s*Workflow\b/)) components.add('kind:Workflow');

  return [...components];
}

// ─── Luigi Component Extractor ───

/**
 * Extract Task class names, requires() dependencies, and output() targets from Luigi Python code.
 * @param {string} content - Python source code
 * @returns {string[]} Extracted task/dependency/output references
 */
function extractLuigiComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract Task subclass names
  const classMatches = contentStr.match(/class\s+(\w+)\s*\(\s*(?:luigi\.)?\w*Task\b/g) || [];
  classMatches.forEach(m => {
    const name = m.match(/class\s+(\w+)/)?.[1];
    if (name) components.add(`task:${name}`);
  });

  // Extract requires() dependencies — yield/return TaskName()
  const reqMatches = contentStr.match(/def\s+requires[\s\S]*?(?=\ndef\s|\nclass\s|$)/g) || [];
  reqMatches.forEach(block => {
    const deps = block.match(/(?:yield|return)\s+(\w+)\s*\(/g) || [];
    deps.forEach(d => {
      const name = d.match(/(?:yield|return)\s+(\w+)/)?.[1];
      if (name && name !== 'self') components.add(`dependency:${name}`);
    });
  });

  // Extract output() targets — LocalTarget, S3Target, etc.
  const outputMatches = contentStr.match(/(\w*Target)\s*\(/g) || [];
  outputMatches.forEach(m => {
    const name = m.replace('(', '');
    if (name) components.add(`output:${name}`);
  });

  // Detect Luigi Parameter types
  const paramMatches = contentStr.match(/luigi\.(\w*Parameter)\b/g) || [];
  paramMatches.forEach(m => {
    const name = m.replace('luigi.', '');
    components.add(`param:${name}`);
  });

  return [...components];
}

// ─── ComfyUI Normalizer ───

/**
 * Normalize a ComfyUI workflow from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeComfyUI(data) {
  const { searchResult, content, filename } = data;
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  const classTypes = extractComfyUIComponents(parsed);

  // Count nodes and links
  const nodeKeys = Object.keys(parsed).filter(k => parsed[k]?.class_type);
  const nodeCount = nodeKeys.length;

  // Count links from inputs referencing other nodes
  let linkCount = 0;
  for (const key of nodeKeys) {
    const inputs = parsed[key]?.inputs || {};
    for (const val of Object.values(inputs)) {
      if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'string') {
        linkCount++;
      }
    }
  }

  const hasCustomNodes = classTypes.some(t =>
    !t.startsWith('KSampler') && !t.startsWith('CLIP') &&
    !t.startsWith('VAE') && !t.startsWith('Load') &&
    !t.startsWith('Save') && !t.startsWith('Empty')
  );

  const complexity = nodeCount > 20 ? 'complex' : nodeCount > 8 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'comfyui'),
    source: 'comfyui',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-comfyui-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: parsed,
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: classTypes,
      node_count: nodeCount,
      connection_count: linkCount,
      trigger_type: 'manual',
      credentials_required: [],
      has_code_node: false,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'comfyui',
    tool_metadata: {
      class_types: classTypes,
      link_count: linkCount,
      has_custom_nodes: hasCustomNodes,
    },
    language: 'json',
  };
}

// ─── Dify Normalizer ───

/**
 * Normalize a Dify app config from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeDify(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const components = extractDifyComponents(contentStr);

  // Extract app_mode
  const appModeMatch = contentStr.match(/app_mode:\s*["']?(\w+)["']?/);
  const appMode = appModeMatch?.[1] || 'unknown';

  // Extract model provider
  const providerMatch = contentStr.match(/provider:\s*["']?(\w[\w.-]*)["']?/);
  const modelProvider = providerMatch?.[1] || 'unknown';

  // Extract tool names
  const tools = [];
  const toolMatches = contentStr.match(/tool_label:\s*["']?([^"'\n]+)["']?/g) || [];
  toolMatches.forEach(t => {
    const name = t.match(/tool_label:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim();
    if (name) tools.push(name);
  });

  const lines = contentStr.split('\n').length;
  const complexity = lines > 200 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'dify'),
    source: 'dify',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-dify-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: components,
      node_count: components.length,
      connection_count: 0,
      trigger_type: 'programmatic',
      credentials_required: [],
      has_code_node: false,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'dify',
    tool_metadata: {
      app_mode: appMode,
      model_provider: modelProvider,
      tools,
    },
    language: 'yaml',
  };
}

// ─── Flowise Normalizer ───

/**
 * Normalize a Flowise chatflow from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeFlowise(data) {
  const { searchResult, content, filename } = data;
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  const nodeNames = extractFlowiseComponents(parsed);

  const nodes = parsed.nodes || [];
  const edges = parsed.edges || [];
  const edgeCount = edges.length;
  const hasMemory = nodeNames.some(n =>
    n.toLowerCase().includes('memory') || n.toLowerCase().includes('buffer')
  );

  const complexity = nodes.length > 15 ? 'complex' : nodes.length > 5 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'flowise'),
    source: 'flowise',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-flowise-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: parsed,
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: nodeNames,
      node_count: nodes.length,
      connection_count: edgeCount,
      trigger_type: 'webhook',
      credentials_required: [],
      has_code_node: false,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'flowise',
    tool_metadata: {
      node_names: nodeNames,
      edge_count: edgeCount,
      has_memory: hasMemory,
    },
    language: 'json',
  };
}

// ─── Pipedream Normalizer ───

/**
 * Normalize a Pipedream component/workflow from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizePipedream(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const components = extractPipedreamComponents(contentStr);

  // Extract component names
  const compNames = components
    .filter(c => c.startsWith('component:'))
    .map(c => c.replace('component:', ''));

  // Extract app names
  const apps = components
    .filter(c => c.startsWith('app:'))
    .map(c => c.replace('app:', ''));

  const hasTrigger = contentStr.includes('trigger') || contentStr.includes('$.interface.timer');
  const triggerType = hasTrigger ? 'event' : 'programmatic';

  const lines = contentStr.split('\n').length;
  const complexity = lines > 150 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'pipedream'),
    source: 'pipedream',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-pipedream-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: [...components],
      node_count: components.length,
      connection_count: 0,
      trigger_type: triggerType,
      credentials_required: apps,
      has_code_node: true,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'pipedream',
    tool_metadata: {
      components: compNames,
      has_trigger: hasTrigger,
      apps,
    },
    language: 'javascript',
  };
}

// ─── Argo Normalizer ───

/**
 * Normalize an Argo Workflow from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeArgo(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractArgoComponents(contentStr);

  // Extract specific categories
  const templates = allComponents
    .filter(c => c.startsWith('template:'))
    .map(c => c.replace('template:', ''));

  const images = allComponents
    .filter(c => c.startsWith('image:'))
    .map(c => c.replace('image:', ''));

  // Detect kind
  const kindMatch = contentStr.match(/kind:\s*(\w+)/);
  const kind = kindMatch?.[1] || 'Workflow';

  const triggerType = contentStr.includes('CronWorkflow') ? 'cron' : 'programmatic';

  const lines = contentStr.split('\n').length;
  const complexity = lines > 200 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'argo'),
    source: 'argo',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-argo-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: [...allComponents],
      node_count: templates.length,
      connection_count: 0,
      trigger_type: triggerType,
      credentials_required: [],
      has_code_node: false,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'argo',
    tool_metadata: {
      templates,
      images,
      kind,
    },
    language: 'yaml',
  };
}

// ─── Luigi Normalizer ───

/**
 * Normalize a Luigi workflow from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeLuigi(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractLuigiComponents(contentStr);

  // Extract specific categories
  const tasks = allComponents
    .filter(c => c.startsWith('task:'))
    .map(c => c.replace('task:', ''));

  const dependencies = allComponents
    .filter(c => c.startsWith('dependency:'))
    .map(c => c.replace('dependency:', ''));

  const outputs = allComponents
    .filter(c => c.startsWith('output:'))
    .map(c => c.replace('output:', ''));

  const lines = contentStr.split('\n').length;
  const complexity = lines > 200 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'luigi'),
    source: 'luigi',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-luigi-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: [...allComponents],
      node_count: tasks.length,
      connection_count: dependencies.length,
      trigger_type: 'programmatic',
      credentials_required: [],
      has_code_node: true,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'luigi',
    tool_metadata: {
      tasks,
      dependencies,
      outputs,
    },
    language: 'python',
  };
}

// ─── MLflow Component Extractor ───

/**
 * Extract components from MLflow tracking/project code.
 * @param {string} content - Python source code
 * @returns {string[]} Extracted experiment/run/model references
 */
function extractMlflowComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract experiment names
  const expMatches = contentStr.match(/set_experiment\(\s*["']([^"']+)["']/g) || [];
  expMatches.forEach(m => {
    const name = m.match(/["']([^"']+)["']/)?.[1];
    if (name) components.add(`experiment:${name}`);
  });

  // Extract log_param / log_metric calls
  const paramMatches = contentStr.match(/log_param\(\s*["']([^"']+)["']/g) || [];
  paramMatches.forEach(m => {
    const name = m.match(/["']([^"']+)["']/)?.[1];
    if (name) components.add(`param:${name}`);
  });

  const metricMatches = contentStr.match(/log_metric\(\s*["']([^"']+)["']/g) || [];
  metricMatches.forEach(m => {
    const name = m.match(/["']([^"']+)["']/)?.[1];
    if (name) components.add(`metric:${name}`);
  });

  // Extract model logging
  const modelMatches = contentStr.match(/mlflow\.(\w+)\.log_model/g) || [];
  modelMatches.forEach(m => {
    const flavor = m.match(/mlflow\.(\w+)/)?.[1];
    if (flavor) components.add(`model:${flavor}`);
  });

  // Detect run context
  if (contentStr.includes('start_run')) components.add('run:start_run');
  if (contentStr.includes('autolog')) components.add('feature:autolog');

  // Detect registry
  if (contentStr.includes('register_model') || contentStr.includes('MlflowClient')) {
    components.add('feature:model_registry');
  }

  return [...components];
}

// ─── Tekton Component Extractor ───

/**
 * Extract task/step names, images, params, and workspaces from Tekton YAML.
 * @param {string} content - YAML string of Tekton Pipeline/Task
 * @returns {string[]} Extracted component references
 */
function extractTektonComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract task names from spec.tasks[].name
  const taskMatches = contentStr.match(/- name:\s*["']?(\w[\w.-]*)["']?/g) || [];
  taskMatches.forEach(m => {
    const name = m.match(/- name:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`task:${name}`);
  });

  // Extract step names from spec.steps[].name
  const stepMatches = contentStr.match(/name:\s*["']?(\w[\w.-]*)["']?/g) || [];
  stepMatches.forEach(m => {
    const name = m.match(/name:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`step:${name}`);
  });

  // Extract container images
  const imageMatches = contentStr.match(/image:\s*["']?([^\s"'\n]+)["']?/g) || [];
  imageMatches.forEach(m => {
    const image = m.match(/image:\s*["']?([^\s"'\n]+)["']?/)?.[1];
    if (image) components.add(`image:${image}`);
  });

  // Extract params
  const paramMatches = contentStr.match(/- name:\s*["']?(\w[\w.-]*)["']?\s*\n\s*(?:type|default|description)/g) || [];
  paramMatches.forEach(m => {
    const name = m.match(/- name:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (name) components.add(`param:${name}`);
  });

  // Extract workspaces
  const wsMatches = contentStr.match(/workspaces:\s*\n(?:\s*- name:\s*["']?(\w[\w.-]*)["']?\n?)+/g) || [];
  wsMatches.forEach(block => {
    const names = block.match(/- name:\s*["']?(\w[\w.-]*)["']?/g) || [];
    names.forEach(n => {
      const name = n.match(/- name:\s*["']?(\w[\w.-]*)["']?/)?.[1];
      if (name) components.add(`workspace:${name}`);
    });
  });

  return [...components];
}

// ─── Tekton Normalizer ───

/**
 * Normalize a Tekton Pipeline/Task from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeTekton(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractTektonComponents(contentStr);

  const steps = allComponents.filter(c => c.startsWith('step:')).map(c => c.replace('step:', ''));
  const images = allComponents.filter(c => c.startsWith('image:')).map(c => c.replace('image:', ''));
  const params = allComponents.filter(c => c.startsWith('param:')).map(c => c.replace('param:', ''));
  const workspaces = allComponents.filter(c => c.startsWith('workspace:')).map(c => c.replace('workspace:', ''));

  const lines = contentStr.split('\n').length;
  const complexity = lines > 200 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'tekton'),
    source: 'tekton',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-tekton-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: [...allComponents],
      node_count: steps.length || allComponents.length,
      connection_count: 0,
      trigger_type: 'programmatic',
      credentials_required: [],
      has_code_node: false,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'tekton',
    tool_metadata: {
      steps,
      images,
      params,
      workspaces,
    },
    language: 'yaml',
  };
}

// ─── GitHub Actions Component Extractor ───

/**
 * Extract job names, action references, triggers, and runners from GitHub Actions YAML.
 * @param {string} content - YAML string of GitHub Actions workflow
 * @returns {string[]} Extracted component references
 */
function extractGitHubActionsComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract uses: action references
  const usesMatches = contentStr.match(/uses:\s*["']?([^\s"'\n]+)["']?/g) || [];
  usesMatches.forEach(m => {
    const action = m.match(/uses:\s*["']?([^\s"'\n]+)["']?/)?.[1];
    if (action) components.add(`action:${action}`);
  });

  // Extract job names
  const jobSection = contentStr.match(/jobs:\s*\n([\s\S]*)/)?.[1] || '';
  const jobMatches = jobSection.match(/^  (\w[\w-]*):/gm) || [];
  jobMatches.forEach(m => {
    const name = m.match(/(\w[\w-]*):/)?.[1];
    if (name) components.add(`job:${name}`);
  });

  // Extract triggers from on: section
  const triggers = ['push', 'pull_request', 'schedule', 'workflow_dispatch',
    'workflow_call', 'release', 'issues', 'issue_comment'];
  triggers.forEach(t => {
    if (contentStr.includes(t + ':') || contentStr.includes(t + '\n')) {
      components.add(`trigger:${t}`);
    }
  });

  // Extract runs-on values
  const runnerMatches = contentStr.match(/runs-on:\s*["']?([^\s"'\n]+)["']?/g) || [];
  runnerMatches.forEach(m => {
    const runner = m.match(/runs-on:\s*["']?([^\s"'\n]+)["']?/)?.[1];
    if (runner) components.add(`runner:${runner}`);
  });

  return [...components];
}

// ─── GitHub Actions Normalizer ───

/**
 * Normalize a GitHub Actions workflow from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeGitHubActions(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractGitHubActionsComponents(contentStr);

  const jobs = allComponents.filter(c => c.startsWith('job:')).map(c => c.replace('job:', ''));
  const actionsUsed = allComponents.filter(c => c.startsWith('action:')).map(c => c.replace('action:', ''));
  const triggers = allComponents.filter(c => c.startsWith('trigger:')).map(c => c.replace('trigger:', ''));
  const runners = allComponents.filter(c => c.startsWith('runner:')).map(c => c.replace('runner:', ''));

  // Detect trigger type
  let triggerType = 'event';
  if (triggers.includes('schedule')) triggerType = 'cron';
  else if (triggers.includes('workflow_dispatch')) triggerType = 'manual';
  else if (triggers.includes('push') || triggers.includes('pull_request')) triggerType = 'event';

  const lines = contentStr.split('\n').length;
  const complexity = lines > 200 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  // Extract workflow name from content
  const nameMatch = contentStr.match(/^name:\s*["']?([^"'\n]+)["']?/m);
  const workflowName = nameMatch?.[1]?.trim() ||
    extractNameFromPath(searchResult.path || filename || 'untitled');

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'github-actions'),
    source: 'github-actions',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-actions-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: workflowName,
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: actionsUsed,
      node_count: jobs.length,
      connection_count: 0,
      trigger_type: triggerType,
      credentials_required: [],
      has_code_node: contentStr.includes('run:'),
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'github-actions',
    tool_metadata: {
      jobs,
      actions_used: actionsUsed,
      triggers,
      runners,
    },
    language: 'yaml',
  };
}

// ─── Home Assistant Component Extractor ───

/**
 * Extract triggers, conditions, actions, and integrations from Home Assistant YAML.
 * @param {string} content - YAML string of Home Assistant automation
 * @returns {string[]} Extracted component references
 */
function extractHomeAssistantComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract trigger platforms
  const triggerMatches = contentStr.match(/platform:\s*["']?(\w[\w.-]*)["']?/g) || [];
  triggerMatches.forEach(m => {
    const platform = m.match(/platform:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (platform) components.add(`trigger:${platform}`);
  });

  // Extract service calls (e.g., light.turn_on, switch.toggle)
  const serviceMatches = contentStr.match(/service:\s*["']?(\w+\.\w+)["']?/g) || [];
  serviceMatches.forEach(m => {
    const service = m.match(/service:\s*["']?(\w+\.\w+)["']?/)?.[1];
    if (service) {
      components.add(`service:${service}`);
      // Extract integration name (domain before the dot)
      const integration = service.split('.')[0];
      if (integration) components.add(`integration:${integration}`);
    }
  });

  // Extract condition types
  const conditionMatches = contentStr.match(/condition:\s*["']?(\w[\w.-]*)["']?/g) || [];
  conditionMatches.forEach(m => {
    const condition = m.match(/condition:\s*["']?(\w[\w.-]*)["']?/)?.[1];
    if (condition) components.add(`condition:${condition}`);
  });

  // Extract entity_id references for integration detection
  const entityMatches = contentStr.match(/entity_id:\s*["']?(\w+)\./g) || [];
  entityMatches.forEach(m => {
    const domain = m.match(/entity_id:\s*["']?(\w+)/)?.[1];
    if (domain) components.add(`integration:${domain}`);
  });

  return [...components];
}

// ─── Home Assistant Normalizer ───

/**
 * Normalize a Home Assistant automation from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeHomeAssistant(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractHomeAssistantComponents(contentStr);

  const triggers = allComponents.filter(c => c.startsWith('trigger:')).map(c => c.replace('trigger:', ''));
  const conditions = allComponents.filter(c => c.startsWith('condition:')).map(c => c.replace('condition:', ''));
  const actions = allComponents.filter(c => c.startsWith('service:')).map(c => c.replace('service:', ''));
  const integrations = [...new Set(
    allComponents.filter(c => c.startsWith('integration:')).map(c => c.replace('integration:', ''))
  )];

  // Extract alias/name
  const aliasMatch = contentStr.match(/alias:\s*["']?([^"'\n]+)["']?/);
  const workflowName = aliasMatch?.[1]?.trim() ||
    extractNameFromPath(searchResult.path || filename || 'untitled');

  const nodeTypes = [...new Set([...triggers, ...actions])];

  const complexity = allComponents.length > 15 ? 'complex'
    : allComponents.length > 5 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'home-assistant'),
    source: 'home-assistant',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-ha-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: workflowName,
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: nodeTypes,
      node_count: actions.length + triggers.length,
      connection_count: 0,
      trigger_type: triggers.includes('time') ? 'cron' : 'event',
      credentials_required: [],
      has_code_node: contentStr.includes('python_script') || contentStr.includes('shell_command'),
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'home-assistant',
    tool_metadata: {
      triggers,
      conditions,
      actions,
      integrations,
    },
    language: 'yaml',
  };
}

// ─── dbt Component Extractor ───

/**
 * Extract refs, sources, materialization, and tests from dbt SQL/YAML.
 * @param {string} content - SQL or YAML content
 * @param {string} filename - File name for context
 * @returns {string[]} Extracted component references
 */
function extractDbtComponents(content, filename) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract materialization from config block
  const matMatch = contentStr.match(/materialized\s*=\s*["'](\w+)["']/);
  if (matMatch) components.add(`materialization:${matMatch[1]}`);

  // Extract ref() calls
  const refMatches = contentStr.match(/\{\{\s*ref\(\s*["']([^"']+)["']\s*\)\s*\}\}/g) || [];
  refMatches.forEach(m => {
    const name = m.match(/ref\(\s*["']([^"']+)["']/)?.[1];
    if (name) components.add(`ref:${name}`);
  });

  // Extract source() calls
  const sourceMatches = contentStr.match(/\{\{\s*source\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)\s*\}\}/g) || [];
  sourceMatches.forEach(m => {
    const match = m.match(/source\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
    if (match) components.add(`source:${match[1]}.${match[2]}`);
  });

  // Extract test types from YAML schema files
  const testMatches = contentStr.match(/- (\w+):/g) || [];
  const knownTests = ['unique', 'not_null', 'accepted_values', 'relationships'];
  testMatches.forEach(m => {
    const name = m.match(/- (\w+)/)?.[1];
    if (name && knownTests.includes(name)) components.add(`test:${name}`);
  });

  // Extract project name from dbt_project.yml
  if (filename?.includes('dbt_project')) {
    const projMatch = contentStr.match(/name:\s*["']?(\w[\w.-]*)["']?/);
    if (projMatch) components.add(`project:${projMatch[1]}`);
  }

  return [...components];
}

// ─── dbt Normalizer ───

/**
 * Normalize a dbt model/config from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeDbt(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractDbtComponents(contentStr, filename);

  const refs = allComponents.filter(c => c.startsWith('ref:')).map(c => c.replace('ref:', ''));
  const sources = allComponents.filter(c => c.startsWith('source:')).map(c => c.replace('source:', ''));
  const tests = allComponents.filter(c => c.startsWith('test:')).map(c => c.replace('test:', ''));
  const matComp = allComponents.find(c => c.startsWith('materialization:'));
  const materialization = matComp ? matComp.replace('materialization:', '') : 'view';

  const isSql = filename?.endsWith('.sql');
  const lang = isSql ? 'sql' : 'yaml';

  // Model name from filename
  const modelName = filename?.replace(/\.[^.]+$/, '').split('/').pop() || 'untitled';
  const workflowName = extractNameFromPath(searchResult.path || filename || modelName);

  const complexity = allComponents.length > 10 ? 'complex'
    : allComponents.length > 3 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'dbt'),
    source: 'dbt',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-dbt-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: workflowName,
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: [...refs, ...sources],
      node_count: refs.length + sources.length,
      connection_count: refs.length,
      trigger_type: 'programmatic',
      credentials_required: [],
      has_code_node: isSql,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'dbt',
    tool_metadata: {
      materialization,
      sources,
      refs,
      tests,
    },
    language: lang,
  };
}

// ─── Camunda Component Extractor ───

/**
 * Extract BPMN element types from Camunda BPMN/XML.
 * @param {string} content - BPMN XML string
 * @returns {string[]} Extracted element references
 */
function extractCamundaComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Extract task types
  const taskTypes = ['serviceTask', 'userTask', 'scriptTask', 'sendTask',
    'receiveTask', 'businessRuleTask', 'manualTask', 'callActivity'];
  taskTypes.forEach(t => {
    const regex = new RegExp(`bpmn:${t}|bpmn2:${t}|<${t}`, 'g');
    const matches = contentStr.match(regex) || [];
    if (matches.length > 0) components.add(`task:${t}`);
  });

  // Extract gateway types
  const gatewayTypes = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway',
    'eventBasedGateway', 'complexGateway'];
  gatewayTypes.forEach(g => {
    const regex = new RegExp(`bpmn:${g}|bpmn2:${g}|<${g}`, 'g');
    const matches = contentStr.match(regex) || [];
    if (matches.length > 0) components.add(`gateway:${g}`);
  });

  // Extract event types
  const eventTypes = ['startEvent', 'endEvent', 'intermediateCatchEvent',
    'intermediateThrowEvent', 'boundaryEvent'];
  eventTypes.forEach(e => {
    const regex = new RegExp(`bpmn:${e}|bpmn2:${e}|<${e}`, 'g');
    const matches = contentStr.match(regex) || [];
    if (matches.length > 0) components.add(`event:${e}`);
  });

  // Detect timer events
  if (contentStr.includes('timerEventDefinition') || contentStr.includes('timeDuration') ||
      contentStr.includes('timeCycle')) {
    components.add('feature:timer');
  }

  // Detect message events
  if (contentStr.includes('messageEventDefinition')) {
    components.add('feature:message');
  }

  return [...components];
}

// ─── Camunda Normalizer ───

/**
 * Normalize a Camunda BPMN process from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeCamunda(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractCamundaComponents(contentStr);

  const taskTypes = allComponents.filter(c => c.startsWith('task:')).map(c => c.replace('task:', ''));
  const eventTypes = allComponents.filter(c => c.startsWith('event:')).map(c => c.replace('event:', ''));
  const gatewayCount = allComponents.filter(c => c.startsWith('gateway:')).length;
  const hasTimer = allComponents.some(c => c === 'feature:timer');

  // Extract process name
  const nameMatch = contentStr.match(/name=["']([^"']+)["']/);
  const workflowName = nameMatch?.[1]?.trim() ||
    extractNameFromPath(searchResult.path || filename || 'untitled');

  const complexity = allComponents.length > 15 ? 'complex'
    : allComponents.length > 5 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'camunda'),
    source: 'camunda',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-camunda-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: workflowName,
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: [...allComponents],
      node_count: taskTypes.length + eventTypes.length,
      connection_count: 0,
      trigger_type: hasTimer ? 'cron' : 'event',
      credentials_required: [],
      has_code_node: taskTypes.includes('scriptTask'),
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'camunda',
    tool_metadata: {
      task_types: taskTypes,
      gateway_count: gatewayCount,
      event_types: eventTypes,
      has_timer: hasTimer,
    },
    language: 'xml',
  };
}

// ─── Kafka Connect Component Extractor ───

/**
 * Extract connector class, topics, and transforms from Kafka Connect config.
 * @param {string} content - JSON or properties string
 * @returns {string[]} Extracted component references
 */
function extractKafkaConnectComponents(content) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  // Try JSON parse first
  let config = null;
  try {
    const parsed = JSON.parse(contentStr);
    config = parsed.config || parsed;
  } catch { /* not JSON, use string matching */ }

  if (config) {
    if (config['connector.class']) components.add(`class:${config['connector.class']}`);
    if (config.topics) {
      config.topics.split(',').forEach(t => components.add(`topic:${t.trim()}`));
    }
    if (config['topics.regex']) components.add(`topic_regex:${config['topics.regex']}`);
    // Detect transforms
    if (config.transforms) {
      config.transforms.split(',').forEach(t => components.add(`transform:${t.trim()}`));
    }
  } else {
    // String-based fallback
    const classMatch = contentStr.match(/connector\.class\s*[=:]\s*["']?([^\s"',]+)["']?/);
    if (classMatch) components.add(`class:${classMatch[1]}`);

    const topicMatch = contentStr.match(/topics\s*[=:]\s*["']?([^\s"'\n]+)["']?/);
    if (topicMatch) {
      topicMatch[1].split(',').forEach(t => components.add(`topic:${t.trim()}`));
    }

    const transformMatch = contentStr.match(/transforms\s*[=:]\s*["']?([^\s"'\n]+)["']?/);
    if (transformMatch) {
      transformMatch[1].split(',').forEach(t => components.add(`transform:${t.trim()}`));
    }
  }

  return [...components];
}

// ─── Kafka Connect Normalizer ───

/**
 * Normalize a Kafka Connect connector config from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeKafkaConnect(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);
  const allComponents = extractKafkaConnectComponents(contentStr);

  const classComp = allComponents.find(c => c.startsWith('class:'));
  const connectorClass = classComp ? classComp.replace('class:', '') : 'unknown';
  const topics = allComponents.filter(c => c.startsWith('topic:')).map(c => c.replace('topic:', ''));
  const transforms = allComponents.filter(c => c.startsWith('transform:')).map(c => c.replace('transform:', ''));

  // Detect source vs sink from class name
  const classLower = connectorClass.toLowerCase();
  const connectorType = classLower.includes('source') ? 'source'
    : classLower.includes('sink') ? 'sink' : 'unknown';

  const complexity = allComponents.length > 10 ? 'complex'
    : allComponents.length > 3 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'kafka-connect'),
    source: 'kafka-connect',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-kafka-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: [connectorClass],
      node_count: 1,
      connection_count: topics.length,
      trigger_type: connectorType === 'source' ? 'event' : 'programmatic',
      credentials_required: [],
      has_code_node: false,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'kafka-connect',
    tool_metadata: {
      connector_class: connectorClass,
      connector_type: connectorType,
      topics,
      transforms,
    },
    language: 'json',
  };
}

// ─── Camel Component Extractor ───

/**
 * Extract route components, EIP patterns from Apache Camel Java/YAML.
 * @param {string} content - Java or YAML source code
 * @param {string} lang - Language of the content
 * @returns {string[]} Extracted component references
 */
function extractCamelComponents(content, lang) {
  const components = new Set();
  const contentStr = typeof content === 'string' ? content : String(content);

  if (lang === 'java') {
    // Extract from/to URIs: from("http://..."), to("kafka:topic"), etc.
    const uriMatches = contentStr.match(/(?:from|to|toD)\(\s*["'](\w+):/g) || [];
    uriMatches.forEach(m => {
      const comp = m.match(/["'](\w+):/)?.[1];
      if (comp) components.add(`component:${comp}`);
    });

    // Detect EIP patterns
    if (contentStr.includes('.split(')) components.add('eip:split');
    if (contentStr.includes('.aggregate(')) components.add('eip:aggregate');
    if (contentStr.includes('.filter(')) components.add('eip:filter');
    if (contentStr.includes('.multicast(')) components.add('eip:multicast');
    if (contentStr.includes('.choice(')) components.add('eip:choice');
    if (contentStr.includes('.recipientList(')) components.add('eip:recipientList');
    if (contentStr.includes('.wireTap(')) components.add('eip:wireTap');
    if (contentStr.includes('.enrich(')) components.add('eip:enrich');

    // Count routes
    const routeCount = (contentStr.match(/from\(\s*["']/g) || []).length;
    if (routeCount > 0) components.add(`routes:${routeCount}`);
  } else {
    // YAML DSL
    const uriMatches = contentStr.match(/uri:\s*["']?(\w+):/g) || [];
    uriMatches.forEach(m => {
      const comp = m.match(/["']?(\w+):/)?.[1];
      if (comp && comp !== 'uri') components.add(`component:${comp}`);
    });

    // Detect EIP patterns in YAML
    const eipPatterns = ['split', 'aggregate', 'filter', 'multicast', 'choice', 'recipientList'];
    eipPatterns.forEach(p => {
      if (contentStr.includes(`${p}:`)) components.add(`eip:${p}`);
    });

    const fromCount = (contentStr.match(/- from:/g) || []).length;
    if (fromCount > 0) components.add(`routes:${fromCount}`);
  }

  return [...components];
}

// ─── Camel Normalizer ───

/**
 * Normalize an Apache Camel route from GitHub.
 * @param {object} data - { searchResult, content, filename }
 */
function normalizeCamel(data) {
  const { searchResult, content, filename } = data;
  const contentStr = typeof content === 'string' ? content : String(content);

  const isJava = filename?.endsWith('.java');
  const lang = isJava ? 'java' : 'yaml';
  const allComponents = extractCamelComponents(contentStr, lang);

  const componentsUsed = allComponents
    .filter(c => c.startsWith('component:'))
    .map(c => c.replace('component:', ''));

  const eipPatterns = allComponents
    .filter(c => c.startsWith('eip:'))
    .map(c => c.replace('eip:', ''));

  const routesComp = allComponents.find(c => c.startsWith('routes:'));
  const routeCount = routesComp ? parseInt(routesComp.replace('routes:', ''), 10) : 0;

  const lines = contentStr.split('\n').length;
  const complexity = lines > 200 ? 'complex' : lines > 50 ? 'moderate' : 'simple';

  return {
    id: randomUUID(),
    hash: generateContentHash(content, 'camel'),
    source: 'camel',
    source_url: searchResult.html_url,
    source_id: searchResult.sha || `gh-camel-${searchResult.html_url}`,
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    workflow_json: { source_code: contentStr, filename },
    workflow_name: extractNameFromPath(searchResult.path || filename || 'untitled'),
    original_description: searchResult.repository?.description || '',
    author: {
      username: searchResult.repository?.owner?.login || 'unknown',
      profile_url: searchResult.repository?.owner?.html_url || null,
    },
    metadata: {
      node_types: componentsUsed,
      node_count: componentsUsed.length,
      connection_count: routeCount,
      trigger_type: componentsUsed.includes('timer') || componentsUsed.includes('quartz') ? 'cron' : 'event',
      credentials_required: [],
      has_code_node: isJava,
      estimated_complexity: complexity,
      github_repo: searchResult.repository?.full_name || '',
      github_stars: searchResult.repository?.stargazers_count || 0,
    },
    quality: {
      score: 0,
      has_description: !!searchResult.repository?.description,
      has_documentation: false,
      is_complete: true,
      validation_status: 'untested',
    },
    tool_type: 'camel',
    tool_metadata: {
      language: lang,
      routes: routeCount,
      components_used: componentsUsed,
      eip_patterns: eipPatterns,
    },
    language: lang,
  };
}
