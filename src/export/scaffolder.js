// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Scaffolder — Generate project scaffolds from artifact packages.
 *
 * Produces a set of files (path + content) that form a ready-to-use
 * project directory for a given artifact. The scaffold type is derived
 * from artifact_type + type_metadata + tool_type.
 *
 * Supported scaffold types:
 *   - workflow/n8n:             Docker Compose + .env + README
 *   - workflow/other:           Docker Compose for the tool + .env + README
 *   - code_pattern/python:      pyproject.toml + src/ + tests/ + README
 *   - code_pattern/js|ts:       package.json + src/ + tests/ + README
 *   - infra_config/terraform:   main.tf + variables.tf + outputs.tf + tfvars.example
 *   - infra_config/helm:        Chart.yaml + values.yaml + templates/
 *   - infra_config/k8s:         kustomization.yaml + base/
 *   - ai_ml_asset:              requirements.txt + src/model.py + notebooks/ + README
 *   - default:                  README.md + artifact.json
 */

// ── Type Detection ───────────────────────────────────────────────────────────

/**
 * Detect the runtime, framework, and scaffold type from an artifact.
 *
 * @param {object} artifact
 * @returns {{ runtime: string, framework: string, scaffoldType: string }}
 */
export function detectProjectType(artifact) {
  const artifactType = artifact.artifact_type || '';
  const toolType = (artifact.tool_type || '').toLowerCase();
  const language = (artifact.language || '').toLowerCase();
  const typeMeta = artifact.type_metadata || {};
  const tags = (artifact.tags || []).map(t => t.toLowerCase());
  const name = (artifact.name || '').toLowerCase();

  // Workflow artifacts
  if (artifactType === 'workflow') {
    if (toolType === 'n8n') {
      return { runtime: 'docker', framework: 'n8n', scaffoldType: 'workflow-n8n' };
    }
    if (toolType === 'airflow') {
      return { runtime: 'python', framework: 'airflow', scaffoldType: 'workflow-airflow' };
    }
    if (toolType === 'prefect') {
      return { runtime: 'python', framework: 'prefect', scaffoldType: 'workflow-python' };
    }
    if (toolType === 'dagster') {
      return { runtime: 'python', framework: 'dagster', scaffoldType: 'workflow-python' };
    }
    if (toolType === 'temporal') {
      return { runtime: 'python', framework: 'temporal', scaffoldType: 'workflow-python' };
    }
    return { runtime: 'docker', framework: toolType || 'generic', scaffoldType: 'workflow-generic' };
  }

  // Code pattern artifacts
  if (artifactType === 'code_pattern') {
    const isPython = language === 'python' ||
      tags.some(t => t === 'python') ||
      (typeMeta.language || '').toLowerCase() === 'python';
    const isTS = language === 'typescript' ||
      tags.some(t => t === 'typescript') ||
      (typeMeta.language || '').toLowerCase() === 'typescript';
    const isJS = language === 'javascript' ||
      tags.some(t => t === 'javascript') ||
      (typeMeta.language || '').toLowerCase() === 'javascript';

    if (isPython) {
      return { runtime: 'python', framework: typeMeta.framework || 'python', scaffoldType: 'code-python' };
    }
    if (isTS) {
      return { runtime: 'node', framework: typeMeta.framework || 'typescript', scaffoldType: 'code-typescript' };
    }
    if (isJS) {
      return { runtime: 'node', framework: typeMeta.framework || 'javascript', scaffoldType: 'code-javascript' };
    }
    // Default code pattern to javascript
    return { runtime: 'node', framework: 'javascript', scaffoldType: 'code-javascript' };
  }

  // Infrastructure config artifacts
  if (artifactType === 'infra_config') {
    const configType = (typeMeta.config_type || toolType || '').toLowerCase();

    if (configType.includes('terraform') || configType === 'terraform') {
      return { runtime: 'terraform', framework: 'terraform', scaffoldType: 'infra-terraform' };
    }
    if (configType.includes('helm') || tags.some(t => t === 'helm')) {
      return { runtime: 'kubernetes', framework: 'helm', scaffoldType: 'infra-helm' };
    }
    if (
      configType.includes('k8s') ||
      configType.includes('kubernetes') ||
      configType.includes('kustomize') ||
      tags.some(t => ['k8s', 'kubernetes', 'kustomize'].includes(t))
    ) {
      return { runtime: 'kubernetes', framework: 'kustomize', scaffoldType: 'infra-k8s' };
    }
    if (configType.includes('docker') || configType === 'docker-compose') {
      return { runtime: 'docker', framework: 'docker-compose', scaffoldType: 'infra-docker' };
    }
    if (configType.includes('ansible')) {
      return { runtime: 'ansible', framework: 'ansible', scaffoldType: 'infra-ansible' };
    }
    // Default infra to terraform
    return { runtime: 'terraform', framework: 'terraform', scaffoldType: 'infra-terraform' };
  }

  // AI/ML asset artifacts
  if (artifactType === 'ai_ml_asset') {
    const framework = (typeMeta.framework || typeMeta.model_type || '').toLowerCase();
    return { runtime: 'python', framework: framework || 'pytorch', scaffoldType: 'ai-ml' };
  }

  // API spec artifacts
  if (artifactType === 'api_spec') {
    return { runtime: 'node', framework: 'openapi', scaffoldType: 'api-spec' };
  }

  // Data asset artifacts
  if (artifactType === 'data_asset') {
    return { runtime: 'python', framework: 'pandas', scaffoldType: 'data-asset' };
  }

  // Documentation artifacts
  if (artifactType === 'documentation') {
    return { runtime: 'none', framework: 'markdown', scaffoldType: 'documentation' };
  }

  return { runtime: 'unknown', framework: 'unknown', scaffoldType: 'default' };
}

// ── Scaffold Generators ──────────────────────────────────────────────────────

function scaffoldWorkflowN8n(artifact) {
  const name = artifact.name || 'workflow';
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const description = artifact.description || 'n8n workflow deployment';

  return [
    {
      path: 'docker-compose.yml',
      content: `version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    container_name: ${slug}-n8n
    restart: unless-stopped
    ports:
      - "\${N8N_PORT:-5678}:5678"
    environment:
      - N8N_HOST=\${N8N_HOST:-localhost}
      - N8N_PROTOCOL=\${N8N_PROTOCOL:-http}
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=\${N8N_BASIC_AUTH_USER:-admin}
      - N8N_BASIC_AUTH_PASSWORD=\${N8N_BASIC_AUTH_PASSWORD:-changeme}
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=\${DB_POSTGRESDB_DATABASE:-n8n}
      - DB_POSTGRESDB_USER=\${DB_POSTGRESDB_USER:-n8n}
      - DB_POSTGRESDB_PASSWORD=\${DB_POSTGRESDB_PASSWORD:-changeme}
      - WEBHOOK_URL=\${WEBHOOK_URL:-http://localhost:5678}
    volumes:
      - n8n_data:/home/node/.n8n
      - ./workflows:/home/node/.n8n/workflows
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:5678/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15-alpine
    container_name: ${slug}-postgres
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
`,
    },
    {
      path: '.env',
      content: `# n8n Configuration
N8N_HOST=localhost
N8N_PORT=5678
N8N_PROTOCOL=http
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=changeme
WEBHOOK_URL=http://localhost:5678

# Database
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=changeme
`,
    },
    {
      path: 'README.md',
      content: `# ${name}

${description}

## Prerequisites

- Docker and Docker Compose installed
- Ports 5678 (n8n) and 5432 (PostgreSQL) available

## Setup

1. Copy the environment template:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

2. Edit \`.env\` with your credentials and configuration.

3. Start the services:
   \`\`\`bash
   docker compose up -d
   \`\`\`

4. Open n8n at http://localhost:5678 and import the workflow.

## Importing the Workflow

1. Log in to n8n using the credentials from \`.env\`.
2. Go to **Workflows** → **Import from File**.
3. Select \`workflows/workflow.json\` (place your exported workflow here).

## Stopping

\`\`\`bash
docker compose down
\`\`\`

To also remove volumes:
\`\`\`bash
docker compose down -v
\`\`\`
`,
    },
    {
      path: '.env.example',
      content: `# n8n Configuration
N8N_HOST=localhost
N8N_PORT=5678
N8N_PROTOCOL=http
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=changeme
WEBHOOK_URL=http://localhost:5678

# Database
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=changeme
`,
    },
  ];
}

function scaffoldWorkflowGeneric(artifact) {
  const name = artifact.name || 'workflow';
  const toolType = artifact.tool_type || 'generic';
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const description = artifact.description || `${toolType} workflow deployment`;

  return [
    {
      path: 'docker-compose.yml',
      content: `version: '3.8'

# Docker Compose configuration for ${name}
# Tool: ${toolType}

services:
  app:
    image: ${toolType}:latest
    container_name: ${slug}
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
`,
    },
    {
      path: '.env',
      content: `# ${toolType} configuration
# Add required environment variables here
`,
    },
    {
      path: '.env.example',
      content: `# ${toolType} configuration
# Copy to .env and fill in values
`,
    },
    {
      path: 'README.md',
      content: `# ${name}

${description}

## Setup

1. Copy \`.env.example\` to \`.env\` and configure your settings.
2. Run \`docker compose up -d\` to start the service.
3. Import your workflow definition according to the ${toolType} documentation.
`,
    },
  ];
}

function scaffoldCodePython(artifact) {
  const name = artifact.name || 'project';
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const description = artifact.description || 'Python project';
  const typeMeta = artifact.type_metadata || {};
  const framework = (typeMeta.framework || '').toLowerCase();
  const content = artifact.content || {};
  const sourceCode = content.source_code || content.code || '# Your implementation here\n';

  const deps = ['# Add your dependencies here'];
  if (framework === 'fastapi') deps.push('fastapi>=0.100.0', 'uvicorn[standard]>=0.20.0');
  else if (framework === 'flask') deps.push('flask>=3.0.0');
  else if (framework === 'django') deps.push('django>=5.0.0');

  return [
    {
      path: 'pyproject.toml',
      content: `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "${slug}"
version = "0.1.0"
description = "${description.replace(/"/g, '\\"')}"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
${deps.map(d => `    "${d}",`).join('\n')}
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-cov>=4.0.0",
    "ruff>=0.3.0",
]

[tool.ruff]
line-length = 100
target-version = "py310"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
    },
    {
      path: 'src/__init__.py',
      content: `"""${name} — ${description}"""

__version__ = "0.1.0"
`,
    },
    {
      path: 'src/main.py',
      content: `"""Main module for ${name}."""

${sourceCode}
`,
    },
    {
      path: 'tests/__init__.py',
      content: '',
    },
    {
      path: 'tests/test_main.py',
      content: `"""Tests for ${name}."""

import pytest
from src.main import *


class TestMain:
    """Test suite for main module."""

    def test_placeholder(self):
        """Placeholder test — replace with real tests."""
        assert True

    # TODO: Add tests for your implementation
`,
    },
    {
      path: 'README.md',
      content: `# ${name}

${description}

## Setup

\`\`\`bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\\Scripts\\activate

# Install dependencies
pip install -e ".[dev]"
\`\`\`

## Usage

\`\`\`python
from src.main import *

# Your usage here
\`\`\`

## Testing

\`\`\`bash
pytest
\`\`\`
`,
    },
  ];
}

function scaffoldCodeJavaScript(artifact, isTypeScript = false) {
  const name = artifact.name || 'project';
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const description = artifact.description || 'JavaScript project';
  const content = artifact.content || {};
  const sourceCode = content.source_code || content.code || '// Your implementation here\n';
  const ext = isTypeScript ? 'ts' : 'js';

  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: slug,
        version: '0.1.0',
        description,
        type: 'module',
        main: `src/index.${ext}`,
        scripts: {
          start: `node src/index.${ext}`,
          test: 'node --test tests/',
          ...(isTypeScript ? { build: 'tsc', 'type-check': 'tsc --noEmit' } : {}),
        },
        ...(isTypeScript ? {
          devDependencies: {
            typescript: '^5.4.0',
            '@types/node': '^20.0.0',
          },
        } : {}),
      }, null, 2) + '\n',
    },
    ...(isTypeScript ? [{
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist'],
      }, null, 2) + '\n',
    }] : []),
    {
      path: `src/index.${ext}`,
      content: `// ${name}
// ${description}

${sourceCode}
`,
    },
    {
      path: `tests/index.test.${ext}`,
      content: `// Tests for ${name}
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('${name}', () => {
  it('placeholder test — replace with real tests', () => {
    assert.ok(true);
  });

  // TODO: Add tests for your implementation
});
`,
    },
    {
      path: 'README.md',
      content: `# ${name}

${description}

## Setup

\`\`\`bash
npm install
\`\`\`

## Usage

\`\`\`bash
npm start
\`\`\`

## Testing

\`\`\`bash
npm test
\`\`\`
`,
    },
  ];
}

function scaffoldInfraTerraform(artifact) {
  const name = artifact.name || 'infrastructure';
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const description = artifact.description || 'Terraform infrastructure configuration';
  const typeMeta = artifact.type_metadata || {};
  const provider = (typeMeta.provider || typeMeta.cloud_provider || 'aws').toLowerCase();
  const content = artifact.content || {};
  const sourceCode = content.source_code || '';

  return [
    {
      path: 'main.tf',
      content: `# ${name}
# ${description}

terraform {
  required_version = ">= 1.5"

  required_providers {
    ${provider} = {
      source  = "hashicorp/${provider}"
      version = "~> 5.0"
    }
  }
}

provider "${provider}" {
  region = var.region
}

${sourceCode || `# Add your Terraform resources here
# Example:
# resource "${provider}_instance" "example" {
#   # ...
# }
`}
`,
    },
    {
      path: 'variables.tf',
      content: `# Variables for ${name}

variable "region" {
  description = "Deployment region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "${slug}"
}

# Add additional variables here
`,
    },
    {
      path: 'outputs.tf',
      content: `# Outputs for ${name}

# Add outputs here
# Example:
# output "instance_id" {
#   description = "ID of the created instance"
#   value       = aws_instance.example.id
# }
`,
    },
    {
      path: 'terraform.tfvars.example',
      content: `# Example values for terraform.tfvars
# Copy this file to terraform.tfvars and fill in your values

region       = "us-east-1"
environment  = "dev"
project_name = "${slug}"
`,
    },
    {
      path: 'README.md',
      content: `# ${name}

${description}

## Prerequisites

- Terraform >= 1.5
- ${provider.toUpperCase()} credentials configured

## Setup

1. Copy variable examples:
   \`\`\`bash
   cp terraform.tfvars.example terraform.tfvars
   \`\`\`

2. Edit \`terraform.tfvars\` with your values.

3. Initialize and apply:
   \`\`\`bash
   terraform init
   terraform plan
   terraform apply
   \`\`\`

## Destroying

\`\`\`bash
terraform destroy
\`\`\`
`,
    },
  ];
}

function scaffoldInfraHelm(artifact) {
  const name = artifact.name || 'chart';
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const description = artifact.description || 'Helm chart';
  const typeMeta = artifact.type_metadata || {};
  const appVersion = typeMeta.app_version || '1.0.0';

  return [
    {
      path: 'Chart.yaml',
      content: `apiVersion: v2
name: ${slug}
description: ${description}
type: application
version: 0.1.0
appVersion: "${appVersion}"
`,
    },
    {
      path: 'values.yaml',
      content: `# Default values for ${slug}

replicaCount: 1

image:
  repository: your-registry/${slug}
  pullPolicy: IfNotPresent
  tag: ""

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: false
  className: ""
  annotations: {}
  hosts:
    - host: ${slug}.local
      paths:
        - path: /
          pathType: Prefix

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80

env: {}
  # KEY: value

secrets: {}
  # SECRET_KEY: secret-value
`,
    },
    {
      path: 'templates/deployment.yaml',
      content: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${slug}.fullname" . }}
  labels:
    {{- include "${slug}.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "${slug}.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "${slug}.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.service.port }}
              protocol: TCP
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
`,
    },
    {
      path: 'templates/service.yaml',
      content: `apiVersion: v1
kind: Service
metadata:
  name: {{ include "${slug}.fullname" . }}
  labels:
    {{- include "${slug}.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "${slug}.selectorLabels" . | nindent 4 }}
`,
    },
    {
      path: 'templates/_helpers.tpl',
      content: `{{/*
Expand the name of the chart.
*/}}
{{- define "${slug}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "${slug}.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "${slug}.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "${slug}.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "${slug}.selectorLabels" -}}
app.kubernetes.io/name: {{ include "${slug}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
`,
    },
    {
      path: 'README.md',
      content: `# ${name} Helm Chart

${description}

## Installing

\`\`\`bash
helm install ${slug} ./${slug} -f values.yaml
\`\`\`

## Upgrading

\`\`\`bash
helm upgrade ${slug} ./${slug} -f values.yaml
\`\`\`

## Uninstalling

\`\`\`bash
helm uninstall ${slug}
\`\`\`

## Configuration

See \`values.yaml\` for all configurable options.
`,
    },
  ];
}

function scaffoldInfraK8s(artifact) {
  const name = artifact.name || 'app';
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const description = artifact.description || 'Kubernetes configuration';
  const content = artifact.content || {};
  const sourceCode = content.source_code || '';

  return [
    {
      path: 'kustomization.yaml',
      content: `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namePrefix: ${slug}-

resources:
  - base/deployment.yaml
  - base/service.yaml

commonLabels:
  app: ${slug}
  managed-by: kustomize
`,
    },
    {
      path: 'base/deployment.yaml',
      content: sourceCode || `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${slug}
  labels:
    app: ${slug}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${slug}
  template:
    metadata:
      labels:
        app: ${slug}
    spec:
      containers:
        - name: ${slug}
          image: your-registry/${slug}:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
`,
    },
    {
      path: 'base/service.yaml',
      content: `apiVersion: v1
kind: Service
metadata:
  name: ${slug}
  labels:
    app: ${slug}
spec:
  selector:
    app: ${slug}
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
  type: ClusterIP
`,
    },
    {
      path: 'README.md',
      content: `# ${name}

${description}

## Prerequisites

- kubectl configured with cluster access
- kustomize (or kubectl >= 1.14)

## Deploying

\`\`\`bash
kubectl apply -k .
\`\`\`

## Checking Deployment Status

\`\`\`bash
kubectl get pods -l app=${slug}
kubectl get services -l app=${slug}
\`\`\`

## Removing

\`\`\`bash
kubectl delete -k .
\`\`\`
`,
    },
  ];
}

function scaffoldAiMl(artifact) {
  const name = artifact.name || 'model';
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const description = artifact.description || 'AI/ML asset';
  const typeMeta = artifact.type_metadata || {};
  const framework = (typeMeta.framework || 'pytorch').toLowerCase();
  const content = artifact.content || {};
  const sourceCode = content.source_code || content.model_config || '';

  const frameworkDeps = {
    pytorch: ['torch>=2.0.0', 'torchvision>=0.15.0'],
    tensorflow: ['tensorflow>=2.15.0'],
    jax: ['jax>=0.4.0', 'flax>=0.8.0'],
    sklearn: ['scikit-learn>=1.4.0'],
    transformers: ['transformers>=4.38.0', 'torch>=2.0.0'],
    'stable-diffusion': ['diffusers>=0.26.0', 'transformers>=4.38.0', 'torch>=2.0.0'],
  };

  const deps = frameworkDeps[framework] || ['torch>=2.0.0'];

  return [
    {
      path: 'requirements.txt',
      content: [
        '# Core ML dependencies',
        ...deps,
        '',
        '# Utilities',
        'numpy>=1.26.0',
        'pandas>=2.2.0',
        'matplotlib>=3.8.0',
        'tqdm>=4.66.0',
        '',
        '# Experiment tracking',
        'mlflow>=2.10.0',
        '',
        '# Development',
        'pytest>=8.0.0',
        'jupyter>=1.0.0',
      ].join('\n') + '\n',
    },
    {
      path: 'src/__init__.py',
      content: `"""${name} — ${description}"""

__version__ = "0.1.0"
`,
    },
    {
      path: 'src/model.py',
      content: `"""Model definition for ${name}."""

${sourceCode || `# ${framework} model implementation
# Replace this with your actual model code

import torch
import torch.nn as nn


class Model(nn.Module):
    """${name} model."""

    def __init__(self, config=None):
        super().__init__()
        self.config = config or {}
        # Define your layers here

    def forward(self, x):
        # Implement forward pass
        return x


def load_model(checkpoint_path=None):
    """Load model from checkpoint."""
    model = Model()
    if checkpoint_path:
        state = torch.load(checkpoint_path, map_location="cpu")
        model.load_state_dict(state)
    return model
`}
`,
    },
    {
      path: 'src/train.py',
      content: `"""Training script for ${name}."""

import mlflow
from src.model import Model


def train(config=None):
    """Main training function."""
    config = config or {}

    with mlflow.start_run():
        model = Model(config)
        mlflow.log_params(config)

        # TODO: Implement training loop
        print("Training started...")

        # mlflow.log_metric("loss", loss, step=epoch)
        # mlflow.pytorch.log_model(model, "model")


if __name__ == "__main__":
    train()
`,
    },
    {
      path: 'notebooks/explore.ipynb',
      content: JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
          kernelspec: {
            display_name: 'Python 3',
            language: 'python',
            name: 'python3',
          },
          language_info: { name: 'python', version: '3.10.0' },
        },
        cells: [
          {
            cell_type: 'markdown',
            metadata: {},
            source: [`# ${name}\n\n${description}`],
          },
          {
            cell_type: 'code',
            execution_count: null,
            metadata: {},
            outputs: [],
            source: [
              'import sys\n',
              'sys.path.insert(0, "..")\n',
              '\n',
              'from src.model import Model\n',
              '\n',
              '# Load model\n',
              'model = Model()\n',
              'print(model)',
            ],
          },
          {
            cell_type: 'markdown',
            metadata: {},
            source: ['## Exploration\n\nAdd your exploration code below.'],
          },
          {
            cell_type: 'code',
            execution_count: null,
            metadata: {},
            outputs: [],
            source: ['# TODO: Add exploration code'],
          },
        ],
      }, null, 2) + '\n',
    },
    {
      path: 'README.md',
      content: `# ${name}

${description}

**Framework:** ${framework}

## Setup

\`\`\`bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
\`\`\`

## Training

\`\`\`bash
python src/train.py
\`\`\`

## Exploration

Open the Jupyter notebook:
\`\`\`bash
jupyter notebook notebooks/explore.ipynb
\`\`\`

## MLflow Tracking

Start the MLflow UI:
\`\`\`bash
mlflow ui --port 5000
\`\`\`
`,
    },
  ];
}

function scaffoldDefault(artifact) {
  const name = artifact.name || 'artifact';
  const description = artifact.description || 'Artifact export';

  return [
    {
      path: 'README.md',
      content: `# ${name}

${description}

## Contents

- \`artifact.json\` — Full artifact data

## Usage

Review \`artifact.json\` for the complete artifact definition and integrate
according to the platform-specific documentation.
`,
    },
    {
      path: 'artifact.json',
      content: JSON.stringify(artifact, null, 2),
    },
  ];
}

// ── Main Scaffolder ──────────────────────────────────────────────────────────

/**
 * Generate a project scaffold for an artifact.
 *
 * @param {object} artifact - Normalized artifact object
 * @returns {{ files: Array<{ path: string, content: string }> }}
 */
export function scaffoldProject(artifact) {
  const { scaffoldType } = detectProjectType(artifact);

  let files;

  switch (scaffoldType) {
    case 'workflow-n8n':
      files = scaffoldWorkflowN8n(artifact);
      break;

    case 'workflow-airflow':
    case 'workflow-python':
    case 'workflow-generic':
      files = scaffoldWorkflowGeneric(artifact);
      break;

    case 'code-python':
      files = scaffoldCodePython(artifact);
      break;

    case 'code-typescript':
      files = scaffoldCodeJavaScript(artifact, true);
      break;

    case 'code-javascript':
      files = scaffoldCodeJavaScript(artifact, false);
      break;

    case 'infra-terraform':
      files = scaffoldInfraTerraform(artifact);
      break;

    case 'infra-helm':
      files = scaffoldInfraHelm(artifact);
      break;

    case 'infra-k8s':
      files = scaffoldInfraK8s(artifact);
      break;

    case 'ai-ml':
      files = scaffoldAiMl(artifact);
      break;

    default:
      files = scaffoldDefault(artifact);
      break;
  }

  return { files };
}
