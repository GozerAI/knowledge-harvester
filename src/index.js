// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { config } from './config.js';
import { db } from './db/client.js';
import {
  listOperationLogs,
  summarizeOperationLogs,
  listHarvestRuns,
  listFailureInbox,
  listSourceHealth,
  logOperationSafely,
} from './db/operation-log-store.js';
import { createSystemRunSafely, updateSystemRunSafely, listSystemRuns } from './db/system-run-store.js';
import { listClaims, listClaimQueue, summarizeClaims, updateClaim } from './db/claim-store.js';
import { listSourceRecords, summarizeSourceRecords } from './db/source-record-store.js';
import { migrate } from './db/migrate.js';
import { logger } from './utils/logger.js';
import { N8nCommunityHarvester } from './harvesters/n8n-community.js';
import { GitHubHarvester } from './harvesters/github.js';
import { RedditHarvester } from './harvesters/reddit.js';
import { GitHubAgentsHarvester } from './harvesters/github-agents.js';
import { GitHubZapierMakeHarvester } from './harvesters/github-zapier-make.js';
import { ActivepiecesHarvester } from './harvesters/activepieces.js';
import { WindmillHarvester } from './harvesters/windmill.js';
import { TemporalHarvester } from './harvesters/temporal.js';
import { AirflowHarvester } from './harvesters/airflow.js';
import { NodeRedHarvester } from './harvesters/node-red.js';
import { PrefectHarvester } from './harvesters/prefect.js';
import { DagsterHarvester } from './harvesters/dagster.js';
import { LangGraphHarvester } from './harvesters/langgraph.js';
import { ComfyUIHarvester } from './harvesters/comfyui.js';
import { DifyHarvester } from './harvesters/dify.js';
import { FlowiseHarvester } from './harvesters/flowise.js';
import { PipedreamHarvester } from './harvesters/pipedream.js';
import { ArgoHarvester } from './harvesters/argo.js';
import { LuigiHarvester } from './harvesters/luigi.js';
import { TektonHarvester } from './harvesters/tekton.js';
import { GitHubActionsHarvester } from './harvesters/github-actions.js';
import { HomeAssistantHarvester } from './harvesters/home-assistant.js';
import { MLflowHarvester } from './harvesters/mlflow.js';
import { DbtHarvester } from './harvesters/dbt.js';
import { CamundaHarvester } from './harvesters/camunda.js';
import { KafkaConnectHarvester } from './harvesters/kafka-connect.js';
import { CamelHarvester } from './harvesters/camel.js';
import { classifyWorkflows } from './processing/classifier.js';
import { scoreWorkflows } from './processing/scorer.js';
import { embedWorkflows } from './processing/embedder.js';
import { packageWorkflows } from './processing/packager.js';
import { generateGuides } from './processing/guide-generator.js';
import { analyzeMigrations } from './processing/migration-analyzer.js';
import { analyzeComplexity } from './processing/complexity-analyzer.js';
import { generateCompositions } from './processing/composition-engine.js';
import { refreshFacets } from './processing/faceted-search.js';
import { embedArtifacts } from './processing/artifact-embedder.js';
import { monetizeArtifacts } from './processing/monetizer.js';
import { generateBundles } from './processing/bundler.js';
import { registerWorkflowStrategies } from './processing/strategies/workflow/index.js';
import { registerInfraConfigStrategies } from './processing/strategies/infra-config/index.js';
import { registerCodePatternStrategies } from './processing/strategies/code-pattern/index.js';
import { registerAiMlAssetStrategies } from './processing/strategies/ai-ml-asset/index.js';
import { registerApiSpecStrategies } from './processing/strategies/api-spec/index.js';
import { registerDataAssetStrategies } from './processing/strategies/data-asset/index.js';
import { registerDocumentationStrategies } from './processing/strategies/documentation/index.js';
import { ARTIFACT_TYPES, listStrategies } from './processing/registry.js';
import { TerraformHarvester } from './harvesters/terraform.js';
import { HelmHarvester } from './harvesters/helm.js';
import { DockerComposeHarvester } from './harvesters/docker-compose-harvester.js';
import { K8sManifestsHarvester } from './harvesters/k8s-manifests.js';
import { AnsibleHarvester } from './harvesters/ansible.js';
import { createYamlHarvesters } from './harvesters/yaml-harvester.js';
// ── Wave 3: Quality Improvements ──
import { detectLicenseBatch } from './processing/license-detector.js';
import { validateArtifactsBatch } from './processing/validator.js';
import { detectTestsBatch } from './processing/test-detector.js';
import { scoreFreshnessBatch } from './processing/freshness-scorer.js';
// ── Wave 3: Search & Discovery ──
import { buildRelations } from './processing/relation-builder.js';
import { generateRecommendations } from './processing/recommender.js';
import { enrichWithTrends } from './processing/trend-enricher.js';
// ── F3: Semantic Dedup ──
import { runSemanticDedup } from './processing/semantic-dedup.js';
// ── F1: Predictive Quality Decay ──
import { scoreBatchDecay } from './processing/decay-predictor.js';
// ── F5: Multi-Language Understanding ──
import { batchExtractUnderstanding } from './processing/understanding-extractor.js';
import { batchExtractClaims } from './processing/claim-extractor.js';
// ── F11: Intelligence Graph ──
import { materializeGraph } from './db/graph-store.js';
// ── Autonomy Expansion ──
import { getEventBus } from './processing/event-bus.js';
import { getScheduler } from './processing/scheduler.js';
import { createSnapshot, listSnapshots, compareSnapshots } from './processing/snapshots.js';
import { discoverRelated, discoverClusters, discoverBridges } from './processing/graph-discovery.js';
import { analyzeCoverage, identifyGaps, getCoverageReport } from './processing/coverage-analyzer.js';
import { thisVsLast, velocityReport } from './processing/time-compare.js';
import { refreshBatch } from './processing/auto-refresh.js';
import { syncFromTrendscope } from './integrations/trendscope-sync.js';
// ── Wave 3: More Harvesters ──
import { CIConfigsHarvester } from './harvesters/ci-configs.js';
import { DockerfileHarvester } from './harvesters/dockerfile.js';
import { JupyterHarvester } from './harvesters/jupyter.js';
import { ShellScriptsHarvester } from './harvesters/shell-scripts.js';
import { MakefileHarvester } from './harvesters/makefile.js';
import { CompetitiveIntelHarvester } from './harvesters/competitive-intel.js';

// ─── CLI Command Definitions ───

const COMMANDS = {
  harvest:       runHarvest,
  classify:      runClassify,
  score:         runScore,
  embed:         runEmbed,
  package:       runPackage,
  guide:         runGuide,
  migrate:       runMigrate,
  migrations:    runMigrationAnalysis,
  complexity:    runComplexity,
  compose:       runCompositions,
  facets:        runFacets,
  monetize:      runMonetize,
  bundle:        runBundles,
  pipeline:      runFullPipeline,
  stats:         runStats,
  // ── Wave 3: Quality Improvements ──
  license:       runLicenseDetection,
  validate:      runValidation,
  'test-detect': runTestDetection,
  freshness:     runFreshnessScoring,
  // ── Wave 3: Search & Discovery ──
  relations:     runRelations,
  recommend:     runRecommendations,
  // ── Trendscope Integration ──
  'enrich-trends': runTrendEnrichment,
  // ── F3: Semantic Dedup ──
  'dedup-semantic': dedupSemantic,
  // ── F1: Predictive Quality Decay ──
  decay:           decayPredict,
  // ── F5: Multi-Language Understanding ──
  understand:      runUnderstanding,
  claims:          runClaims,
  'claim-queue':   runClaimQueue,
  'claim-review':  runClaimReview,
  'claims-extract': runClaimExtraction,
  // ── F11: Intelligence Graph ──
  'graph-materialize': graphMaterialize,
  // ── Autonomy Expansion ──
  schedule:            runScheduleCmd,
  snapshot:            runSnapshotCmd,
  discover:            runDiscoverCmd,
  coverage:            runCoverageCmd,
  compare:             runCompareCmd,
  'auto-refresh':      runAutoRefresh,
  'sync-trends':       runSyncTrends,
  pulse:               runPulse,
  errors:              runErrors,
  runs:                runRuns,
  inbox:               runInbox,
  'source-health':     runSourceHealth,
  'source-records':    runSourceRecords,
  'system-runs':       runSystemRuns,
};


const USAGE = `
Knowledge Harvester — Multi-Tool Automation & Asset Library Builder

Usage: node src/index.js <command> [options]

Commands:
  harvest    --source <source|all>   Harvest workflows from a specific source or all
  classify   [--limit N]             Classify unclassified workflows via Ollama
  score      [--limit N]             Score unscored workflows
  embed      [--limit N]             Generate vector embeddings for semantic search
  package    [--limit N] [--id ID]   Generate deployment packages for workflows
  guide      [--limit N]             Generate setup guides for packaged workflows
  migrate                            Run database migrations
  migrations [--limit N]             Analyze cross-tool migration suggestions
  complexity [--limit N]             Run multi-dimensional complexity analysis
  compose    [--limit N]             Generate workflow composition suggestions
  facets                             Refresh and display search facets
  monetize   [--limit N]             Assign price tiers and marketplace metadata
  bundle                             Generate curated artifact bundles
  license    [--limit N]             Detect licenses for artifacts
  validate   [--limit N]             Run per-type validation on artifacts
  test-detect [--limit N]            Detect test coverage signals
  freshness  [--limit N]             Score artifact freshness via GitHub API
  relations  [--limit N]             Build artifact relation graph
  recommend  [--limit N]             Generate artifact recommendations
  enrich-trends [--limit N]            Enrich artifacts with Trendscope signals
  dedup-semantic [--limit N] [--threshold F]  Detect semantic duplicates and select canonicals
  decay      [--limit N]             Score predictive quality decay for artifacts
  understand [--limit N]             Extract LLM-driven understanding metadata via Ollama
  claims     [--limit N] [--status S] [--claim-type T]  Review extracted claims
  claim-queue [--limit N] [--status S] [--search Q]     Show evidence-aware claim review queue
  claim-review --id ID [--status S] [--confidence F]    Update claim adjudication fields
  claims-extract [--limit N]         Extract candidate claims from accepted source records
  graph-materialize                  Materialize intelligence graph from artifacts & relations
  schedule   <list|run|enable|disable> [--name N]  Manage scheduled automations
  snapshot   <create|list|compare> [--label L] [--a ID --b ID]  Manage snapshots
  discover   <related|clusters|bridges> [--id ID]  Graph-powered discovery
  coverage                           Category coverage analysis
  compare    [--period week|month|day]  Time-window comparison
  auto-refresh [--threshold F] [--limit N]  Auto-refresh stale artifacts
  sync-trends                        Sync intelligence with Trendscope
  pulse                              Autonomy system pulse dashboard
  errors     [--limit N] [--since-hours H] [--run-id ID] [--system-run-id ID]  Show recent operational warnings and errors
  runs       [--limit N] [--status S]       Show recent harvest runs with warning/error counts
  inbox      [--limit N] [--since-hours H]  Show grouped actionable failures
  source-health [--limit N]                 Show source reliability and recent failure status
  source-records [--limit N] [--decision D] [--source S]  Show accepted/discarded source appendix records
  system-runs [--limit N] [--status S]      Show recent command and pipeline runs
  pipeline                           Run full 23-step pipeline
  stats                              Show database statistics

Sources (37+ built-in, 27 workflow + 10 infra/code + YAML-defined):
  n8n-community      n8n official template library (~7,888 templates)
  github             n8n workflows on GitHub (code search)
  reddit             r/n8n community posts
  github-agents      AI agent frameworks (LangChain, CrewAI, AutoGen)
  github-zapier-make Zapier, Make.com, IFTTT configs on GitHub
  activepieces       Activepieces template gallery
  windmill           Windmill OpenFlow definitions on GitHub
  temporal           Temporal workflow code (Python, TS, Go, Java)
  airflow            Apache Airflow DAGs on GitHub
  node-red           Node-RED flow library (flows.nodered.org)
  prefect            Prefect flow/task definitions on GitHub
  dagster            Dagster asset/op/job definitions on GitHub
  langgraph          LangGraph agent graphs on GitHub (Python, TS)
  comfyui            ComfyUI image/video generation workflows
  dify               Dify AI application workflows
  flowise            Flowise chatflow and agentflow definitions
  pipedream          Pipedream event-driven workflows
  argo               Argo Workflows Kubernetes-native DAGs
  luigi              Luigi batch processing pipeline definitions
  tekton             Tekton Pipelines on Kubernetes
  github-actions     GitHub Actions CI/CD workflows
  home-assistant     Home Assistant automations and blueprints
  mlflow             MLflow experiment tracking and model pipelines
  dbt                dbt data transformation models
  camunda            Camunda BPMN process definitions
  kafka-connect      Kafka Connect connector configurations
  camel              Apache Camel integration routes

  Infrastructure Configs (→ artifacts table):
  terraform          Terraform modules and configs (HCL)
  helm               Helm chart definitions (Chart.yaml, values, templates)
  docker-compose     Docker Compose service definitions
  k8s-manifests      Kubernetes manifest YAML files
  ansible            Ansible playbooks and roles
  ci-configs         CI/CD configs (GitHub Actions, GitLab CI, Jenkins)
  dockerfile         Dockerfile patterns (multi-stage, non-root, healthcheck)
  jupyter            Jupyter notebooks (PyTorch, TensorFlow, scikit-learn)
  shell-scripts      Shell scripts (deploy, setup, install, entrypoint)
  makefile           Makefiles (build automation patterns)

  Programmable (YAML-defined, drop files in src/definitions/):
  fastapi-patterns   FastAPI middleware and router patterns
  pytorch-training   PyTorch model training scripts and configs
  react-patterns     React component and hook patterns
  openapi-specs      OpenAPI/Swagger API specifications
  asyncapi-specs     AsyncAPI event-driven API specifications
  grpc-protos        gRPC protobuf service definitions
  graphql-schemas    GraphQL schema definitions
  sql-schemas        SQL database schema definitions
  adrs               Architecture Decision Records
  runbooks           Operational runbooks and procedures
  security-policies  Security and governance policy documents
  compliance-controls Compliance control matrices and evidence docs
  support-playbooks  Support troubleshooting and escalation playbooks
  product-requirements Product requirement docs and specs
  release-checklists Release, cutover, and go-live checklists
  vendor-assessments Vendor risk and due diligence assessments
  legal-contracts    Contracts, agreements, and legal operating docs
  finance-controls   Finance controls, budgeting, and close procedures
  employee-handbooks Employee handbooks and people-ops guides
  privacy-governance Privacy and data handling governance docs
  board-governance   Board and committee governance records
  sales-playbooks    Sales and revenue-ops playbooks
  sales-enablement   Sales enablement, battlecards, and training docs
  customer-onboarding Customer onboarding guides and checklists
  customer-success-playbooks Customer success and renewal playbooks
  hr-onboarding      Employee onboarding guides and checklists
  incident-postmortems Incident postmortems and outage retrospectives
  mcp-servers        Model Context Protocol servers and tools
  open-policy-agent  Rego policy-as-code rules
  aws-step-functions AWS Step Functions state machines
  google-workflows   Google Cloud Workflows definitions
  kestra-flows       Kestra orchestration flows and tasks
  flyte-workflows    Flyte workflow and task definitions
  pulumi-programs    Pulumi infrastructure programs
  cloudformation-templates AWS CloudFormation and SAM templates
  (add your own .yaml files to extend!)

Artifact Types: workflow, code_pattern, infra_config, ai_ml_asset,
                api_spec, data_asset, documentation

Examples:
  node src/index.js pipeline
  node src/index.js harvest --source n8n-community
  node src/index.js harvest --source terraform
  node src/index.js harvest --source fastapi-patterns
  node src/index.js classify --limit 100
`;

// ─── Main Entry Point ───

async function main() {
  // Initialize strategy registry
  registerWorkflowStrategies();
  registerInfraConfigStrategies();
  registerCodePatternStrategies();
  registerAiMlAssetStrategies();
  registerApiSpecStrategies();
  registerDataAssetStrategies();
  registerDocumentationStrategies();

  const command = process.argv[2] || 'pipeline';
  const handler = COMMANDS[command];

  if (!handler) {
    console.log(USAGE);
    process.exit(1);
  }

  // Track active harvesters for graceful shutdown
  const activeHarvesters = [];
  const systemRun = await createSystemRunSafely({
    runType: command === 'pipeline' ? 'pipeline' : 'command',
    command,
    trigger: 'cli',
    status: 'running',
    metadata: {
      argv: process.argv.slice(2),
    },
  });
  await logOperationSafely({
    level: 'info',
    category: command === 'pipeline' ? 'pipeline' : 'command',
    eventType: `${command === 'pipeline' ? 'pipeline' : 'command'}.started`,
    message: `Command "${command}" started`,
    command,
    systemRunId: systemRun.id,
    metadata: {
      argv: process.argv.slice(2),
      trigger: 'cli',
    },
  });

  // Graceful shutdown handler
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    activeHarvesters.forEach(h => h.abort());
    await updateSystemRunSafely(systemRun.id, {
      status: 'aborted',
      errorMessage: `Interrupted by ${signal}`,
      completedAt: 'now',
    });
    await logOperationSafely({
      level: 'warn',
      category: command === 'pipeline' ? 'pipeline' : 'command',
      eventType: `${command === 'pipeline' ? 'pipeline' : 'command'}.aborted`,
      message: `Command "${command}" interrupted by ${signal}`,
      command,
      systemRunId: systemRun.id,
      metadata: { signal },
    });
    // Force exit after 5 seconds if cleanup hangs
    setTimeout(() => {
      logger.warn('Forced exit after timeout');
      process.exit(1);
    }, 5000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await handler(activeHarvesters, systemRun.id);
    await updateSystemRunSafely(systemRun.id, {
      status: 'completed',
      completedAt: 'now',
    });
    await logOperationSafely({
      level: 'info',
      category: command === 'pipeline' ? 'pipeline' : 'command',
      eventType: `${command === 'pipeline' ? 'pipeline' : 'command'}.completed`,
      message: `Command "${command}" completed`,
      command,
      systemRunId: systemRun.id,
    });
  } catch (err) {
    logger.error('Command failed', { command, error: err.message, stack: err.stack });
    await logOperationSafely({
      level: 'error',
      category: 'command',
      eventType: 'command.failed',
      message: `Command "${command}" failed`,
      command,
      systemRunId: systemRun.id,
      error: err,
    });
    await updateSystemRunSafely(systemRun.id, {
      status: 'failed',
      errorMessage: err.message,
      completedAt: 'now',
    });
    process.exit(1);
  } finally {
    await db.end();
  }
}

// ─── Command Handlers ───

async function runHarvest(activeHarvesters) {
  const sourceArg = getArg('--source') || 'all';

  const harvesterMap = {
    'n8n-community':      () => new N8nCommunityHarvester(),
    'github':             () => new GitHubHarvester(),
    'reddit':             () => new RedditHarvester(),
    'github-agents':      () => new GitHubAgentsHarvester(),
    'github-zapier-make': () => new GitHubZapierMakeHarvester(),
    'activepieces':       () => new ActivepiecesHarvester(),
    'windmill':           () => new WindmillHarvester(),
    'temporal':           () => new TemporalHarvester(),
    'airflow':            () => new AirflowHarvester(),
    'node-red':           () => new NodeRedHarvester(),
    'prefect':            () => new PrefectHarvester(),
    'dagster':            () => new DagsterHarvester(),
    'langgraph':          () => new LangGraphHarvester(),
    'comfyui':            () => new ComfyUIHarvester(),
    'dify':               () => new DifyHarvester(),
    'flowise':            () => new FlowiseHarvester(),
    'pipedream':          () => new PipedreamHarvester(),
    'argo':               () => new ArgoHarvester(),
    'luigi':              () => new LuigiHarvester(),
    'tekton':             () => new TektonHarvester(),
    'github-actions':     () => new GitHubActionsHarvester(),
    'home-assistant':     () => new HomeAssistantHarvester(),
    'mlflow':             () => new MLflowHarvester(),
    'dbt':                () => new DbtHarvester(),
    'camunda':            () => new CamundaHarvester(),
    'kafka-connect':      () => new KafkaConnectHarvester(),
    'camel':              () => new CamelHarvester(),
    // ── Infra Config Harvesters (artifact table) ──
    'terraform':          () => new TerraformHarvester(),
    'helm':               () => new HelmHarvester(),
    'docker-compose':     () => new DockerComposeHarvester(),
    'k8s-manifests':      () => new K8sManifestsHarvester(),
    'ansible':            () => new AnsibleHarvester(),
    // ── Wave 3 Harvesters ──
    'ci-configs':         () => new CIConfigsHarvester(),
    'dockerfile':         () => new DockerfileHarvester(),
    'jupyter':            () => new JupyterHarvester(),
    'shell-scripts':      () => new ShellScriptsHarvester(),
    'makefile':           () => new MakefileHarvester(),
    'competitive-intel':  () => new CompetitiveIntelHarvester(),
  };

  // Add YAML-defined harvesters dynamically
  const yamlHarvesters = createYamlHarvesters();
  for (const yh of yamlHarvesters) {
    if (!harvesterMap[yh.source]) {
      harvesterMap[yh.source] = () => yh;
    }
  }

  const sources = sourceArg === 'all'
    ? Object.keys(harvesterMap)
    : [sourceArg];

  for (const source of sources) {
    const factory = harvesterMap[source];
    if (!factory) {
      logger.error(`Unknown source: ${source}`);
      continue;
    }
    logger.info(`Starting harvest: ${source}`);
    const harvester = factory();
    activeHarvesters.push(harvester);
    const stats = await harvester.run();
    logger.info(`${source} harvest results`, stats);
  }
}

async function runClassify() {
  const limit = parseInt(getArg('--limit') || '50', 10);
  await classifyWorkflows(limit);
}

async function runScore() {
  const limit = parseInt(getArg('--limit') || '100', 10);
  await scoreWorkflows(limit);
}

async function runEmbed() {
  const limit = parseInt(getArg('--limit') || '100', 10);
  await embedWorkflows(limit);
}

async function runPackage() {
  const limit = parseInt(getArg('--limit') || '50', 10);
  const id = getArg('--id');
  if (id) {
    // Package a single workflow by ID
    await packageWorkflows(1);
  } else {
    await packageWorkflows(limit);
  }
}

async function runGuide() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  await generateGuides(limit);
}

async function runMigrate() {
  await migrate();
}

async function runMigrationAnalysis() {
  const limit = parseInt(getArg('--limit') || '50', 10);
  await analyzeMigrations(limit);
}

async function runComplexity() {
  const limit = parseInt(getArg('--limit') || '100', 10);
  await analyzeComplexity(limit);
}

async function runCompositions() {
  const limit = parseInt(getArg('--limit') || '50', 10);
  await generateCompositions(limit);
}

async function runFacets() {
  const facets = await refreshFacets();
  console.log('\n═══ Search Facets ═══\n');
  console.table(facets);
}

async function runMonetize() {
  const limit = parseInt(getArg('--limit') || '200', 10);
  const result = await monetizeArtifacts(limit);
  console.log('\n═══ Monetization Results ═══\n');
  console.log(`Monetized: ${result.monetized}`);
  if (result.byTier) {
    console.log('By tier:', result.byTier);
  }
}

// ── Wave 3: Quality Improvement Commands ──

async function runLicenseDetection() {
  const limit = parseInt(getArg('--limit') || '200', 10);
  const result = await detectLicenseBatch(db, limit);
  console.log('\n═══ License Detection Results ═══\n');
  console.log(`Processed: ${result.processed}, Licensed: ${result.licensed}, Unknown: ${result.unknown}`);
}

async function runValidation() {
  const limit = parseInt(getArg('--limit') || '200', 10);
  const result = await validateArtifactsBatch(db, limit);
  console.log('\n═══ Validation Results ═══\n');
  console.log(`Processed: ${result.processed}, Valid: ${result.valid}, Invalid: ${result.invalid}`);
}

async function runTestDetection() {
  const limit = parseInt(getArg('--limit') || '200', 10);
  const result = await detectTestsBatch(db, limit);
  console.log('\n═══ Test Detection Results ═══\n');
  console.log(`Processed: ${result.processed}, With tests: ${result.with_tests}, Without: ${result.without_tests}`);
}

async function runFreshnessScoring() {
  const limit = parseInt(getArg('--limit') || '100', 10);
  const result = await scoreFreshnessBatch(db, limit);
  console.log('\n═══ Freshness Scoring Results ═══\n');
  console.log(`Processed: ${result.processed}, Scored: ${result.scored}, Errors: ${result.errors}`);
}

// ── Wave 3: Search & Discovery Commands ──

async function runRelations() {
  const limit = parseInt(getArg('--limit') || '200', 10);
  const result = await buildRelations(db, limit);
  console.log('\n═══ Relation Building Results ═══\n');
  console.log(`Processed: ${result.processed}, Relations created: ${result.relations_created}`);
}

async function runRecommendations() {
  const limit = parseInt(getArg('--limit') || '200', 10);
  const result = await generateRecommendations(db, limit);
  console.log('\n═══ Recommendation Results ═══\n');
  console.log(`Processed: ${result.processed}, Recommendations: ${result.recommendations_generated}`);
}

// ── Trendscope Integration Command ──

async function runTrendEnrichment() {
  const limit = parseInt(getArg('--limit') || '200', 10);
  const result = await enrichWithTrends(db, limit);
  console.log('\n═══ Trend Enrichment Results ═══\n');
  console.log(`Processed: ${result.processed}, Enriched: ${result.enriched}, No match: ${result.no_match}`);
}

// ── F3: Semantic Dedup Command ──

async function dedupSemantic(args = {}) {
  const limit = parseInt(args.limit || getArg('--limit') || '100', 10);
  const threshold = parseFloat(args.threshold || getArg('--threshold') || '0.92');
  const result = await runSemanticDedup(db, limit, threshold);
  console.log('\n═══ Semantic Dedup Results ═══\n');
  console.log(`Groups found: ${result.groups_found}, Canonical selected: ${result.canonical_selected}, Links created: ${result.links_created}`);
}

// ── F1: Predictive Quality Decay Command ──

async function decayPredict(args = {}) {
  const limit = parseInt(args.limit || getArg('--limit') || '100', 10);
  console.log(`Scoring decay risk for up to ${limit} artifacts...`);
  const result = await scoreBatchDecay(db, limit);
  console.log(`Decay prediction complete: ${result.processed} processed, ${result.at_risk} at risk`);
}

// ── F5: Multi-Language Understanding Command ──

async function runUnderstanding(args = {}) {
  const limit = parseInt(args.limit || getArg('--limit') || '50', 10);
  console.log(`Extracting understanding for up to ${limit} artifacts...`);
  const result = await batchExtractUnderstanding(db, limit);
  console.log(`Understanding extraction: ${result.succeeded}/${result.processed} succeeded, ${result.failed} failed`);
}

async function runClaimExtraction(args = {}) {
  const limit = parseInt(args.limit || getArg('--limit') || '100', 10);
  console.log(`Extracting claims from up to ${limit} accepted source records...`);
  const result = await batchExtractClaims(db, limit);
  console.log(
    `Claim extraction: ${result.created}/${result.processed} claims created, ` +
    `${result.evidence_created} evidence records, ${result.skipped} skipped, ${result.failed} failed`,
  );
}

async function runClaims() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const status = getArg('--status');
  const claimType = getArg('--claim-type');
  const subjectType = getArg('--subject-type');
  const sourceRecordId = getArg('--source-record-id');
  const search = getArg('--search');

  const filters = {
    limit,
    status,
    claimType,
    subjectType,
    sourceRecordId,
    search,
  };
  const summary = await summarizeClaims(db, filters);
  const result = await listClaims(db, filters);

  console.log('\n=== Claims ===\n');
  console.log(`Total claims: ${summary.total}`);
  if (summary.by_status.length > 0) {
    console.log('\nBy status:');
    console.table(summary.by_status);
  }
  if (summary.by_type.length > 0) {
    console.log('\nBy type:');
    console.table(summary.by_type);
  }
  if (result.claims.length === 0) {
    console.log('\nNo matching claims found.');
    return;
  }

  console.table(result.claims.map((claim) => ({
    id: claim.id,
    status: claim.status,
    claim_type: claim.claim_type,
    subject_type: claim.subject_type || '-',
    source_record_id: claim.source_record_id || '-',
    confidence: claim.confidence,
    summary: claim.summary || claim.claim_text,
  })));
}

async function runClaimReview() {
  const id = getArg('--id');
  if (!id) {
    throw new Error('--id is required');
  }

  const status = getArg('--status');
  const confidenceArg = getArg('--confidence');
  const summary = getArg('--summary');
  const note = getArg('--note');

  const updates = {};
  if (status) updates.status = status;
  if (confidenceArg !== null) updates.confidence = confidenceArg;
  if (summary !== null) updates.summary = summary;
  if (note) {
    updates.metadata = {
      review_note: note,
      reviewed_at: new Date().toISOString(),
      reviewer: 'cli',
    };
  }

  const claim = await updateClaim(db, id, updates);
  if (!claim) {
    throw new Error('Claim not found');
  }

  console.log('\n=== Claim Updated ===\n');
  console.table([{
    id: claim.id,
    status: claim.status,
    claim_type: claim.claim_type,
    confidence: claim.confidence,
    summary: claim.summary || claim.claim_text,
  }]);
}

async function runClaimQueue() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const status = getArg('--status');
  const claimType = getArg('--claim-type');
  const subjectType = getArg('--subject-type');
  const sourceRecordId = getArg('--source-record-id');
  const search = getArg('--search');

  const filters = {
    limit,
    status,
    claimType,
    subjectType,
    sourceRecordId,
    search,
  };

  const summary = await summarizeClaims(db, filters);
  const queue = await listClaimQueue(db, filters);

  console.log('\n=== Claim Review Queue ===\n');
  console.log(`Needs review: ${summary.review_queue.needs_review}`);
  console.log(`Disputed: ${summary.review_queue.disputed}`);
  console.log(`Accepted without support: ${summary.review_queue.accepted_without_support}`);
  console.log(`With contradictions: ${summary.review_queue.contradicted}`);

  if (queue.claims.length === 0) {
    console.log('\nNo queued claims found.');
    return;
  }

  console.table(queue.claims.map((claim) => ({
    id: claim.id,
    priority: claim.review_priority,
    status: claim.status,
    claim_type: claim.claim_type,
    confidence: claim.confidence,
    supports: claim.supports_count,
    contradicts: claim.contradicts_count,
    context: claim.context_count,
    summary: claim.summary || claim.claim_text,
  })));
}

// ── F11: Intelligence Graph Command ──

async function graphMaterialize(args = {}) {
  console.log('Materializing intelligence graph...');
  const result = await materializeGraph(db);
  console.log(`Graph materialized: ${result.nodes_created} nodes, ${result.edges_created} edges`);
}

// ── Autonomy Expansion Command Handlers ──

async function runScheduleCmd() {
  const sub = process.argv[3] || 'list';
  const name = getArg('--name');
  const scheduler = getScheduler(db);

  if (sub === 'list') {
    const schedules = await scheduler.listSchedules();
    console.log('\n═══ Schedules ═══\n');
    if (schedules.length === 0) {
      console.log('No schedules registered.');
    } else {
      console.table(schedules);
    }
  } else if (sub === 'run' && name) {
    const result = await scheduler.runNow(name);
    console.log(`Schedule "${name}": ${JSON.stringify(result)}`);
  } else if (sub === 'enable' && name) {
    await scheduler.enable(name);
    console.log(`Schedule "${name}" enabled.`);
  } else if (sub === 'disable' && name) {
    await scheduler.disable(name);
    console.log(`Schedule "${name}" disabled.`);
  } else {
    console.log('Usage: schedule <list|run|enable|disable> [--name NAME]');
  }
}

async function runSnapshotCmd() {
  const sub = process.argv[3] || 'list';
  if (sub === 'create') {
    const label = getArg('--label') || `snapshot-${new Date().toISOString().slice(0, 10)}`;
    const snap = await createSnapshot(db, label);
    console.log(`Snapshot created: ${snap.id} (${snap.label})`);
  } else if (sub === 'list') {
    const snaps = await listSnapshots(db);
    console.log('\n═══ Snapshots ═══\n');
    if (snaps.length === 0) {
      console.log('No snapshots found.');
    } else {
      console.table(snaps.map(s => ({ id: s.id, label: s.label, created_at: s.created_at })));
    }
  } else if (sub === 'compare') {
    const a = getArg('--a');
    const b = getArg('--b');
    if (!a || !b) {
      console.log('Usage: snapshot compare --a <ID> --b <ID>');
      return;
    }
    const diff = await compareSnapshots(db, a, b);
    console.log('\n═══ Snapshot Comparison ═══\n');
    console.log(JSON.stringify(diff, null, 2));
  } else {
    console.log('Usage: snapshot <create|list|compare> [--label L] [--a ID --b ID]');
  }
}

async function runDiscoverCmd() {
  const sub = process.argv[3] || 'clusters';
  if (sub === 'related') {
    const id = getArg('--id');
    if (!id) {
      console.log('Usage: discover related --id <ARTIFACT_ID>');
      return;
    }
    const results = await discoverRelated(db, id);
    console.log('\n═══ Related Artifacts ═══\n');
    console.log(JSON.stringify(results, null, 2));
  } else if (sub === 'clusters') {
    const results = await discoverClusters(db);
    console.log('\n═══ Clusters ═══\n');
    console.log(`Found ${results.length} clusters`);
    console.log(JSON.stringify(results, null, 2));
  } else if (sub === 'bridges') {
    const results = await discoverBridges(db);
    console.log('\n═══ Bridge Nodes ═══\n');
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('Usage: discover <related|clusters|bridges> [--id ID]');
  }
}

async function runCoverageCmd() {
  const report = await getCoverageReport(db);
  console.log('\n═══ Coverage Report ═══\n');
  console.log(`Categories: ${report.summary.total_categories}, Types: ${report.summary.total_types}`);
  console.log(`Coverage score: ${report.summary.avg_coverage}`);
  if (report.gaps.length > 0) {
    console.log(`\nGaps (${report.gaps.length}):`);
    console.table(report.gaps);
  }
}

async function runCompareCmd() {
  const period = getArg('--period') || 'week';
  const sub = process.argv[3] || 'this-vs-last';
  if (sub === 'velocity') {
    const report = await velocityReport(db, period);
    console.log('\n═══ Velocity Report ═══\n');
    console.log(JSON.stringify(report, null, 2));
  } else {
    const report = await thisVsLast(db, period);
    console.log(`\n═══ This vs Last ${period} ═══\n`);
    console.log(JSON.stringify(report, null, 2));
  }
}

async function runAutoRefresh() {
  const threshold = parseFloat(getArg('--threshold') || '0.6');
  const limit = parseInt(getArg('--limit') || '50', 10);
  console.log(`Auto-refreshing stale artifacts (threshold=${threshold}, limit=${limit})...`);
  const result = await refreshBatch(db, { threshold, limit });
  console.log(`Auto-refresh complete: ${result.refreshed}/${result.scanned} refreshed, ${result.errors} errors`);
}

async function runSyncTrends() {
  console.log('Syncing intelligence with Trendscope...');
  const result = await syncFromTrendscope(db);
  console.log(`Sync complete: ${JSON.stringify(result)}`);
}

async function runPulse() {
  const { handleAutonomyPulse } = await import('./api/autonomy-routes.js');
  // Direct DB query for CLI pulse
  const schedules = await db.query('SELECT name, enabled, last_status, last_run, run_count FROM schedules ORDER BY name');
  const staleCount = await db.query(
    `SELECT COUNT(*) as count FROM artifacts
     WHERE type_metadata IS NOT NULL
       AND type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk' IS NOT NULL
       AND (type_metadata::jsonb -> 'decay_prediction' ->> 'decay_risk')::float >= 0.6`
  );
  console.log('\n═══ Autonomy System Pulse ═══\n');
  console.log(`Stale artifacts: ${staleCount.rows[0]?.count || 0}`);
  if (schedules.rows.length > 0) {
    console.log('\nSchedules:');
    console.table(schedules.rows);
  }
}

async function runErrors() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const level = getArg('--level') || 'error,warn';
  const category = getArg('--category');
  const source = getArg('--source');
  const command = getArg('--command');
  const runId = getArg('--run-id');
  const systemRunId = getArg('--system-run-id');
  const requestPath = getArg('--request-path');
  const search = getArg('--search');
  const sinceHours = parseInt(getArg('--since-hours') || '24', 10);

  const filters = {
    limit,
    level,
    category,
    source,
    command,
    runId,
    systemRunId,
    requestPath,
    search,
    sinceHours,
  };
  const summary = await summarizeOperationLogs(db, filters);
  const result = await listOperationLogs(db, {
    ...filters,
  });

  console.log('\n=== Operational Errors ===\n');
  console.log(`Window: last ${summary.window_hours}h`);
  console.log(`Total logs: ${summary.total}`);
  if (summary.by_level.length > 0) {
    console.log('\nBy level:');
    console.table(summary.by_level);
  }
  if (summary.by_category.length > 0) {
    console.log('\nBy category:');
    console.table(summary.by_category);
  }
  if (result.logs.length > 0) {
    console.log('\nRecent entries:');
    console.table(result.logs.map(log => ({
      created_at: log.created_at?.toISOString?.() ? log.created_at.toISOString() : log.created_at,
      level: log.level,
      category: log.category,
      event_type: log.event_type,
      source: log.source || log.command || log.request_path || '-',
      run_id: log.run_id || '-',
      system_run_id: log.system_run_id || '-',
      message: log.message,
    })));
  } else {
    console.log('\nNo matching logs found.');
  }
}

async function runRuns() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const status = getArg('--status');
  const source = getArg('--source');
  const result = await listHarvestRuns(db, { limit, status, source });

  console.log('\n=== Harvest Runs ===\n');
  console.log(`Total matching runs: ${result.total}`);
  if (result.runs.length === 0) {
    console.log('No harvest runs found.');
    return;
  }

  console.table(result.runs.map(run => ({
    id: run.id,
    source: run.source,
    status: run.status,
    discovered: run.items_discovered,
    new: run.items_new,
    duplicate: run.items_duplicate,
    invalid: run.items_invalid,
    warnings: run.warning_events,
    errors: run.error_events,
    started_at: run.started_at?.toISOString?.() ? run.started_at.toISOString() : run.started_at,
    completed_at: run.completed_at?.toISOString?.() ? run.completed_at.toISOString() : run.completed_at,
  })));
}

async function runInbox() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const sinceHours = parseInt(getArg('--since-hours') || '72', 10);
  const result = await listFailureInbox(db, { limit, sinceHours });

  console.log('\n=== Failure Inbox ===\n');
  console.log(`Window: last ${result.since_hours}h`);
  console.log(`Grouped failures: ${result.total}`);
  if (result.items.length === 0) {
    console.log('No recent failures.');
    return;
  }

  console.table(result.items.map(item => ({
    emitter: item.emitter,
    category: item.category,
    event_type: item.event_type,
    occurrences: item.occurrence_count,
    last_seen: item.last_seen?.toISOString?.() ? item.last_seen.toISOString() : item.last_seen,
    message: item.message,
  })));
}

async function runSourceHealth() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const sinceHours = parseInt(getArg('--since-hours') || '72', 10);
  const result = await listSourceHealth(db, { limit, sinceHours });

  console.log('\n=== Source Health ===\n');
  console.log(`Window: last ${result.since_hours}h`);
  console.log(`Sources analyzed: ${result.summary.total_sources}`);
  if (Object.keys(result.summary.by_status).length > 0) {
    console.log('\nBy status:');
    console.table(result.summary.by_status);
  }
  if (result.sources.length === 0) {
    console.log('\nNo source health data available.');
    return;
  }

  console.table(result.sources.map(source => ({
    source: source.source,
    health: source.health_status,
    tier: source.reliability_tier,
    score: source.reliability_score,
    errors: source.recent_error_events,
    warnings: source.recent_warning_events,
    latest_run: source.latest_run?.status || '-',
    last_error_at: source.last_error_at?.toISOString?.() ? source.last_error_at.toISOString() : source.last_error_at,
  })));
}

async function runSystemRuns() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const status = getArg('--status');
  const runType = getArg('--run-type');
  const command = getArg('--command');
  const result = await listSystemRuns(db, { limit, status, runType, command });

  console.log('\n=== System Runs ===\n');
  console.log(`Total matching runs: ${result.total}`);
  if (result.runs.length === 0) {
    console.log('No system runs found.');
    return;
  }

  console.table(result.runs.map(run => ({
    id: run.id,
    run_type: run.run_type,
    command: run.command,
    trigger: run.trigger,
    status: run.status,
    current_step: run.current_step,
    warnings: run.warning_events,
    errors: run.error_events,
    started_at: run.started_at?.toISOString?.() ? run.started_at.toISOString() : run.started_at,
    completed_at: run.completed_at?.toISOString?.() ? run.completed_at.toISOString() : run.completed_at,
  })));
}

async function runSourceRecords() {
  const limit = parseInt(getArg('--limit') || '20', 10);
  const decision = getArg('--decision');
  const source = getArg('--source');
  const runId = getArg('--run-id');
  const sinceHours = parseInt(getArg('--since-hours') || '168', 10);
  const filters = { limit, decision, source, runId, sinceHours };
  const summary = await summarizeSourceRecords(db, filters);
  const result = await listSourceRecords(db, filters);

  console.log('\n=== Source Appendix ===\n');
  console.log(`Window: last ${summary.window_hours}h`);
  console.log(`Total records: ${summary.total}`);
  if (summary.by_decision.length > 0) {
    console.log('\nBy decision:');
    console.table(summary.by_decision);
  }
  if (result.records.length === 0) {
    console.log('\nNo source records found.');
    return;
  }

  console.table(result.records.map(record => ({
    recorded_at: record.recorded_at?.toISOString?.() ? record.recorded_at.toISOString() : record.recorded_at,
    source: record.source,
    decision: record.decision,
    item_name: record.item_name || '-',
    stored_kind: record.stored_kind || '-',
    discard_reason: record.discard_reason || '-',
    summary: record.summary || '-',
  })));
}

async function runBundles() {
  const result = await generateBundles();
  console.log('\n═══ Bundle Generation Results ═══\n');
  console.log(`Created: ${result.created}, Updated: ${result.updated}`);
  if (result.bundles.length > 0) {
    console.table(result.bundles.map(b => ({
      name: b.name,
      artifacts: b.artifactCount,
      tier: b.priceTier,
      price: `$${b.suggestedPrice}`,
      quality: b.avgQualityScore,
    })));
  }
}

async function runFullPipeline(activeHarvesters, systemRunId = null) {
  const eventBus = getEventBus();
  const stepNames = [
    'migrate', 'harvest', 'classify', 'score', 'embed', 'package', 'guide',
    'complexity', 'migrations', 'compose', 'monetize', 'bundle', 'license',
    'validate', 'test-detect', 'relations', 'facets', 'enrich-trends',
    'dedup-semantic', 'decay', 'understand', 'claims-extract', 'graph-materialize',
  ];
  const completedSteps = [];
  const markStepStart = async (stepName, index) => {
    await updateSystemRunSafely(systemRunId, {
      currentStep: stepName,
      stepsRequested: stepNames,
      stepsCompleted: completedSteps,
    });
    eventBus.emit('pipeline.step.start', { run_id: systemRunId, step: stepName, index });
    await logOperationSafely({
      level: 'info',
      category: 'pipeline',
      eventType: 'pipeline.step.started',
      message: `Pipeline step started: ${stepName}`,
      command: 'pipeline',
      systemRunId,
      metadata: {
        step: stepName,
        index,
        steps_completed: completedSteps,
      },
    });
  };
  const markStepComplete = async (stepName, index) => {
    completedSteps.push(stepName);
    await updateSystemRunSafely(systemRunId, {
      currentStep: stepName,
      stepsCompleted: completedSteps,
    });
    eventBus.emit('pipeline.step.complete', { run_id: systemRunId, step: stepName, index });
    await logOperationSafely({
      level: 'info',
      category: 'pipeline',
      eventType: 'pipeline.step.completed',
      message: `Pipeline step completed: ${stepName}`,
      command: 'pipeline',
      systemRunId,
      metadata: {
        step: stepName,
        index,
        steps_completed: completedSteps,
      },
    });
  };
  eventBus.emit('pipeline.run.start', { run_id: systemRunId, steps: 23, timestamp: new Date().toISOString() });
  logger.info('═══ Running full pipeline (23 steps) ═══');

  await updateSystemRunSafely(systemRunId, {
    currentStep: null,
    stepsRequested: stepNames,
    stepsCompleted: [],
  });
  await markStepStart('migrate', 1);
  logger.info('Step 1/22: Database migration');
  await migrate();
  await markStepComplete('migrate', 1);

  await markStepStart('harvest', 2);
  logger.info('Step 2/22: Harvesting from all sources');
  await runHarvest(activeHarvesters);
  await markStepComplete('harvest', 2);

  await markStepStart('classify', 3);
  logger.info('Step 3/22: Classifying workflows');
  await runClassify();
  await markStepComplete('classify', 3);

  await markStepStart('score', 4);
  logger.info('Step 4/22: Scoring workflows');
  await runScore();
  await markStepComplete('score', 4);

  await markStepStart('embed', 5);
  logger.info('Step 5/22: Generating embeddings');
  await runEmbed();
  await markStepComplete('embed', 5);

  await markStepStart('package', 6);
  logger.info('Step 6/22: Generating deployment packages');
  await runPackage();
  await markStepComplete('package', 6);

  await markStepStart('guide', 7);
  logger.info('Step 7/22: Generating setup guides');
  await runGuide();
  await markStepComplete('guide', 7);

  await markStepStart('complexity', 8);
  logger.info('Step 8/22: Analyzing complexity');
  await analyzeComplexity(200);
  await markStepComplete('complexity', 8);

  await markStepStart('migrations', 9);
  logger.info('Step 9/22: Analyzing cross-tool migrations');
  await analyzeMigrations(100);
  await markStepComplete('migrations', 9);

  await markStepStart('compose', 10);
  logger.info('Step 10/22: Generating compositions');
  await generateCompositions(50);
  await markStepComplete('compose', 10);

  await markStepStart('monetize', 11);
  logger.info('Step 11/22: Monetizing artifacts');
  await monetizeArtifacts(500);
  await markStepComplete('monetize', 11);

  await markStepStart('bundle', 12);
  logger.info('Step 12/22: Generating bundles');
  await generateBundles();
  await markStepComplete('bundle', 12);

  await markStepStart('license', 13);
  logger.info('Step 13/22: Detecting licenses');
  await detectLicenseBatch(db, 500);
  await markStepComplete('license', 13);

  await markStepStart('validate', 14);
  logger.info('Step 14/22: Validating artifacts');
  await validateArtifactsBatch(db, 500);
  await markStepComplete('validate', 14);

  await markStepStart('test-detect', 15);
  logger.info('Step 15/22: Detecting test coverage');
  await detectTestsBatch(db, 500);
  await markStepComplete('test-detect', 15);

  await markStepStart('relations', 16);
  logger.info('Step 16/22: Building artifact relations');
  await buildRelations(db, 500);
  await markStepComplete('relations', 16);

  await markStepStart('facets', 17);
  logger.info('Step 17/22: Refreshing search facets');
  await refreshFacets();
  await markStepComplete('facets', 17);

  await markStepStart('enrich-trends', 18);
  logger.info('Step 18/22: Enriching with Trendscope signals');
  await enrichWithTrends(db, 500);
  await markStepComplete('enrich-trends', 18);

  await markStepStart('dedup-semantic', 19);
  logger.info('Step 19/22: Semantic duplicate detection');
  await dedupSemantic({});
  await markStepComplete('dedup-semantic', 19);

  await markStepStart('decay', 20);
  logger.info('Step 20/22: Decay prediction');
  await decayPredict({});
  await markStepComplete('decay', 20);

  await markStepStart('understand', 21);
  logger.info('Step 21/23: Understanding extraction');
  await runUnderstanding({});
  await markStepComplete('understand', 21);

  await markStepStart('claims-extract', 22);
  logger.info('Step 22/23: Claim extraction');
  await runClaimExtraction({});
  await markStepComplete('claims-extract', 22);

  await markStepStart('graph-materialize', 23);
  logger.info('Step 23/23: Graph materialization');
  await graphMaterialize({});
  await markStepComplete('graph-materialize', 23);

  logger.info('═══ Full pipeline complete ═══');
  await updateSystemRunSafely(systemRunId, {
    currentStep: null,
    stepsCompleted: completedSteps,
  });
  eventBus.emit('pipeline.run.complete', { run_id: systemRunId, steps: 23, timestamp: new Date().toISOString() });
}

async function runStats() {
  const stats = await db.query(`
    SELECT
      source,
      tool_type,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE quality_score >= 70) as high_quality,
      ROUND(AVG(quality_score)) as avg_quality,
      COUNT(*) FILTER (WHERE primary_category IS NOT NULL) as classified,
      COUNT(*) FILTER (WHERE publishing_status = 'raw') as raw,
      COUNT(*) FILTER (WHERE publishing_status = 'enriched') as enriched
    FROM workflows
    GROUP BY source, tool_type
    ORDER BY total DESC
  `);

  const total = await db.query('SELECT COUNT(*) as count FROM workflows');
  const byTool = await db.query(`
    SELECT tool_type, COUNT(*) as count
    FROM workflows GROUP BY tool_type ORDER BY count DESC
  `);
  const runs = await db.query(`
    SELECT source, status, items_discovered, items_new, items_duplicate,
           started_at, completed_at
    FROM harvest_runs
    ORDER BY started_at DESC
    LIMIT 10
  `);

  const packageCount = await db.query('SELECT COUNT(*) as count FROM workflow_packages');
  const guideCount = await db.query('SELECT COUNT(*) as count FROM workflow_guides');

  console.log('\n═══ Workflow Library Statistics ═══\n');
  console.log(`Total workflows: ${total.rows[0].count}\n`);

  if (byTool.rows.length > 0) {
    console.log('By tool type:');
    console.table(byTool.rows);
  }

  if (stats.rows.length > 0) {
    console.log('\nBy source & tool:');
    console.table(stats.rows);
  }

  if (runs.rows.length > 0) {
    console.log('\nRecent harvest runs:');
    console.table(runs.rows.map(r => ({
      source: r.source,
      status: r.status,
      discovered: r.items_discovered,
      new: r.items_new,
      duplicate: r.items_duplicate,
      started: r.started_at?.toISOString().slice(0, 19),
    })));
  }

  console.log(`\nDeployment packages: ${packageCount.rows[0].count}`);
  console.log(`Setup guides: ${guideCount.rows[0].count}`);

  // Artifact stats (new generalized table)
  try {
    const artifactTotal = await db.query('SELECT COUNT(*) as count FROM artifacts');
    const artifactsByType = await db.query(`
      SELECT artifact_type, COUNT(*) as count
      FROM artifacts GROUP BY artifact_type ORDER BY count DESC
    `);

    if (parseInt(artifactTotal.rows[0].count, 10) > 0) {
      console.log(`\n═══ Artifact Library ═══\n`);
      console.log(`Total artifacts: ${artifactTotal.rows[0].count}`);
      if (artifactsByType.rows.length > 0) {
        console.log('\nBy artifact type:');
        console.table(artifactsByType.rows);
      }

      // Monetization stats
      const byTier = await db.query(`
        SELECT price_tier, COUNT(*) as count,
               ROUND(AVG(quality_score)) as avg_quality
        FROM artifacts WHERE price_tier IS NOT NULL
        GROUP BY price_tier ORDER BY count DESC
      `);
      if (byTier.rows.length > 0) {
        console.log('\nBy price tier:');
        console.table(byTier.rows);
      }
    }
  } catch {
    // artifacts table may not exist yet if migration hasn't run
  }

  // Bundle stats
  try {
    const bundleCount = await db.query('SELECT COUNT(*) as count FROM artifact_bundles');
    if (parseInt(bundleCount.rows[0].count, 10) > 0) {
      const bundlesByTier = await db.query(`
        SELECT price_tier, COUNT(*) as bundles,
               SUM(artifact_count) as total_artifacts,
               ROUND(AVG(suggested_price)::numeric, 2) as avg_price
        FROM artifact_bundles
        GROUP BY price_tier ORDER BY bundles DESC
      `);
      console.log(`\n═══ Marketplace Bundles ═══\n`);
      console.log(`Total bundles: ${bundleCount.rows[0].count}`);
      console.table(bundlesByTier.rows);
    }
  } catch {
    // bundles table may not exist yet
  }
}

// ─── Utility ───

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

// ─── Run ───
main();
