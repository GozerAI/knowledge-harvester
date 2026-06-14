// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Deploy Generator — Generate deployment manifests from artifacts.
 *
 * Supported targets:
 *   - docker-compose:   docker-compose.yml with service, volumes, networks,
 *                       healthcheck, and environment from type_metadata
 *   - k8s:              Kubernetes Deployment + Service YAML
 *   - github-actions:   .github/workflows/deploy.yml CI/CD pipeline
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the container port for an artifact based on its type and tool.
 */
function derivePort(artifact) {
  const toolType = (artifact.tool_type || '').toLowerCase();
  const artifactType = (artifact.artifact_type || '').toLowerCase();
  const typeMeta = artifact.type_metadata || {};

  // Explicit port in metadata
  if (typeMeta.port) return Number(typeMeta.port);
  if (typeMeta.container_port) return Number(typeMeta.container_port);

  const portMap = {
    n8n: 5678,
    airflow: 8080,
    temporal: 7233,
    prefect: 4200,
    dagster: 3000,
    mlflow: 5000,
    flowise: 3000,
    comfyui: 8188,
    dify: 80,
    'github-actions': 443,
    'home-assistant': 8123,
    activepieces: 8080,
    argo: 2746,
    tekton: 9097,
    camunda: 8080,
    'kafka-connect': 8083,
  };

  if (portMap[toolType]) return portMap[toolType];

  // Fallback by artifact type
  if (artifactType === 'api_spec') return 8080;
  if (artifactType === 'ai_ml_asset') return 8000;

  return 8080;
}

/**
 * Derive a Docker image reference for an artifact.
 */
function deriveImage(artifact) {
  const toolType = (artifact.tool_type || '').toLowerCase();
  const typeMeta = artifact.type_metadata || {};
  const name = (artifact.name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (typeMeta.image) return typeMeta.image;
  if (typeMeta.docker_image) return typeMeta.docker_image;

  const imageMap = {
    n8n: 'n8nio/n8n:latest',
    airflow: 'apache/airflow:2.9.0',
    temporal: 'temporalio/server:latest',
    prefect: 'prefecthq/prefect:2-latest',
    dagster: 'dagster/dagster:latest',
    mlflow: 'ghcr.io/mlflow/mlflow:latest',
    flowise: 'flowiseai/flowise:latest',
    comfyui: 'yanwk/comfyui-boot:latest',
    dify: 'langgenius/dify-api:latest',
    'home-assistant': 'ghcr.io/home-assistant/home-assistant:stable',
    activepieces: 'activepieces/activepieces:latest',
    argo: 'argoproj/argocli:latest',
  };

  return imageMap[toolType] || `your-registry/${name}:latest`;
}

/**
 * Extract environment variable entries from type_metadata and tool_metadata.
 * Returns an array of { key, value } pairs.
 */
function extractEnvEntries(artifact) {
  const typeMeta = artifact.type_metadata || {};
  const toolMeta = artifact.tool_metadata || {};
  const toolType = (artifact.tool_type || '').toLowerCase();
  const entries = [];

  // From type_metadata.env_vars (array of { name, value } or strings)
  const envVars = typeMeta.env_vars || typeMeta.environment_variables || [];
  for (const ev of envVars) {
    if (typeof ev === 'string') {
      const [key, ...rest] = ev.split('=');
      entries.push({ key: key.trim(), value: rest.join('=') || '' });
    } else if (ev && ev.name) {
      entries.push({ key: ev.name, value: ev.default || ev.value || '' });
    }
  }

  // Tool-specific canonical env vars
  const toolEnvDefaults = {
    n8n: [
      { key: 'N8N_HOST', value: '${N8N_HOST:-localhost}' },
      { key: 'N8N_BASIC_AUTH_ACTIVE', value: 'true' },
      { key: 'N8N_BASIC_AUTH_USER', value: '${N8N_BASIC_AUTH_USER:-admin}' },
      { key: 'N8N_BASIC_AUTH_PASSWORD', value: '${N8N_BASIC_AUTH_PASSWORD:-changeme}' },
    ],
    airflow: [
      { key: 'AIRFLOW__DATABASE__SQL_ALCHEMY_CONN', value: '${AIRFLOW__DATABASE__SQL_ALCHEMY_CONN}' },
      { key: 'AIRFLOW__CORE__EXECUTOR', value: 'LocalExecutor' },
    ],
    mlflow: [
      { key: 'MLFLOW_TRACKING_URI', value: '${MLFLOW_TRACKING_URI:-http://localhost:5000}' },
    ],
    prefect: [
      { key: 'PREFECT_API_URL', value: '${PREFECT_API_URL:-http://localhost:4200/api}' },
    ],
    dagster: [
      { key: 'DAGSTER_HOME', value: '/opt/dagster' },
    ],
  };

  if (toolEnvDefaults[toolType] && entries.length === 0) {
    entries.push(...toolEnvDefaults[toolType]);
  }

  return entries;
}

// ── Docker Compose Manifest ──────────────────────────────────────────────────

/**
 * Generate a docker-compose.yml manifest.
 */
export function generateDockerComposeManifest(artifact) {
  const name = (artifact.name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const toolType = (artifact.tool_type || '').toLowerCase();
  const image = deriveImage(artifact);
  const port = derivePort(artifact);
  const envEntries = extractEnvEntries(artifact);
  const typeMeta = artifact.type_metadata || {};

  const envLines = envEntries.map(e => `      - ${e.key}=${e.value}`).join('\n');
  const needsDatabase = ['n8n', 'airflow', 'dagster', 'prefect'].includes(toolType) ||
    typeMeta.requires_database;

  const volumeName = `${name}_data`;
  const networkName = `${name}_network`;

  let dbSection = '';
  if (needsDatabase) {
    dbSection = `
  postgres:
    image: postgres:15-alpine
    container_name: ${name}-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=${name}
      - POSTGRES_USER=${name}
      - POSTGRES_PASSWORD=\${DB_PASSWORD:-changeme}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${name}"]
      interval: 10s
      timeout: 5s
      retries: 5
`;
  }

  const dependsOn = needsDatabase
    ? `    depends_on:\n      postgres:\n        condition: service_healthy\n`
    : '';

  const volumeEntries = [`  ${volumeName}:`];
  if (needsDatabase) volumeEntries.push('  postgres_data:');

  return `version: '3.8'

services:
  ${name}:
    image: ${image}
    container_name: ${name}
    restart: unless-stopped
    ports:
      - "\${PORT:-${port}}:${port}"
${envLines ? `    environment:\n${envLines}\n` : ''}    volumes:
      - ${volumeName}:/data
${dependsOn}    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:${port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
${dbSection}
volumes:
${volumeEntries.join('\n')}

networks:
  default:
    name: ${networkName}
`;
}

// ── Kubernetes Manifest ──────────────────────────────────────────────────────

/**
 * Generate a Kubernetes Deployment + Service YAML manifest.
 */
export function generateK8sManifest(artifact) {
  const name = (artifact.name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const image = deriveImage(artifact);
  const port = derivePort(artifact);
  const envEntries = extractEnvEntries(artifact);
  const typeMeta = artifact.type_metadata || {};
  const replicas = typeMeta.replicas || 1;

  const envSection = envEntries.length > 0
    ? envEntries.map(e => `            - name: ${e.key}\n              value: "${e.value}"`).join('\n')
    : '            # No environment variables configured';

  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app: ${name}
    version: "1.0"
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
        version: "1.0"
    spec:
      containers:
        - name: ${name}
          image: ${image}
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: ${port}
              protocol: TCP
          env:
${envSection}
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /health
              port: ${port}
            initialDelaySeconds: 30
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: ${port}
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  type: ClusterIP
  selector:
    app: ${name}
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: ${port}
`;
}

// ── GitHub Actions Manifest ──────────────────────────────────────────────────

/**
 * Generate a GitHub Actions deploy workflow.
 */
export function generateGitHubActionsManifest(artifact) {
  const name = (artifact.name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const language = (artifact.language || '').toLowerCase();
  const toolType = (artifact.tool_type || '').toLowerCase();
  const artifactType = (artifact.artifact_type || '').toLowerCase();

  // Determine setup step based on language / tool type
  const isPython = language === 'python' ||
    ['airflow', 'prefect', 'dagster', 'temporal', 'mlflow', 'luigi', 'dbt'].includes(toolType);

  const isNode = language === 'javascript' || language === 'typescript' ||
    ['n8n', 'flowise', 'pipedream', 'activepieces'].includes(toolType);

  const isTerraform = artifactType === 'infra_config' &&
    ['terraform', 'infra_config'].includes(toolType);

  const isHelm = artifactType === 'infra_config' &&
    (toolType === 'helm' || (artifact.type_metadata || {}).config_type === 'helm');

  let setupSteps = '';
  let buildSteps = '';
  let deploySteps = '';

  if (isPython) {
    setupSteps = `      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: "pip"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt`;

    buildSteps = `      - name: Run tests
        run: pytest --tb=short -q`;

    deploySteps = `      - name: Deploy application
        run: |
          echo "Deploying ${name}..."
          # Add your deployment command here`;

  } else if (isNode) {
    setupSteps = `      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci`;

    buildSteps = `      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build --if-present`;

    deploySteps = `      - name: Deploy application
        run: |
          echo "Deploying ${name}..."
          # Add your deployment command here`;

  } else if (isTerraform) {
    setupSteps = `      - name: Set up Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.7"

      - name: Terraform Init
        run: terraform init
        env:
          TF_TOKEN_app_terraform_io: \${{ secrets.TF_API_TOKEN }}`;

    buildSteps = `      - name: Terraform Validate
        run: terraform validate

      - name: Terraform Plan
        run: terraform plan -no-color
        env:
          TF_VAR_environment: \${{ github.ref == 'refs/heads/main' && 'prod' || 'staging' }}`;

    deploySteps = `      - name: Terraform Apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        run: terraform apply -auto-approve
        env:
          TF_VAR_environment: prod`;

  } else if (isHelm) {
    setupSteps = `      - name: Set up kubectl
        uses: azure/setup-kubectl@v3

      - name: Set up Helm
        uses: azure/setup-helm@v4
        with:
          version: "3.14"

      - name: Configure kubeconfig
        run: echo "\${{ secrets.KUBECONFIG }}" | base64 -d > kubeconfig.yml`;

    buildSteps = `      - name: Helm lint
        run: helm lint .

      - name: Helm template (dry run)
        run: helm template ${name} . --debug`;

    deploySteps = `      - name: Deploy with Helm
        run: |
          helm upgrade --install ${name} . \\
            --namespace default \\
            --create-namespace \\
            --wait \\
            --timeout 5m
        env:
          KUBECONFIG: kubeconfig.yml`;

  } else {
    // Docker / generic
    setupSteps = `      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to container registry
        uses: docker/login-action@v3
        with:
          registry: \${{ vars.REGISTRY }}
          username: \${{ secrets.REGISTRY_USER }}
          password: \${{ secrets.REGISTRY_PASSWORD }}`;

    buildSteps = `      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: \${{ github.ref == 'refs/heads/main' }}
          tags: \${{ vars.REGISTRY }}/${name}:\${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max`;

    deploySteps = `      - name: Deploy application
        if: github.ref == 'refs/heads/main'
        run: |
          echo "Deploying ${name}:\${{ github.sha }}..."
          # Add your deployment command here`;
  }

  return `name: Deploy ${name}

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

concurrency:
  group: deploy-${name}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-deploy:
    name: Build and Deploy
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

${setupSteps}

${buildSteps}

${deploySteps}

  notify:
    name: Notify
    runs-on: ubuntu-latest
    needs: build-and-deploy
    if: always()
    steps:
      - name: Deployment status
        run: |
          if [ "\${{ needs.build-and-deploy.result }}" == "success" ]; then
            echo "Deployment succeeded"
          else
            echo "Deployment failed"
            exit 1
          fi
`;
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generate a deployment manifest for an artifact.
 *
 * @param {object} artifact - Normalized artifact object
 * @param {'docker-compose'|'k8s'|'github-actions'} target
 * @returns {string} Manifest content
 */
export function generateDeployManifest(artifact, target) {
  switch (target) {
    case 'docker-compose':
      return generateDockerComposeManifest(artifact);

    case 'k8s':
      return generateK8sManifest(artifact);

    case 'github-actions':
      return generateGitHubActionsManifest(artifact);

    default:
      throw new Error(
        `Unsupported deployment target: "${target}". ` +
        `Supported targets: docker-compose, k8s, github-actions`
      );
  }
}
