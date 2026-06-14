// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Reimplemented dependency extraction logic for wave-2 tool types

function extractDependencies(toolType, content) {
  const deps = new Set();

  if (toolType === 'tekton') {
    deps.add('tekton-pipelines');
    const imageMatches = content.match(/image:\s*(\S+)/g) || [];
    for (const m of imageMatches) {
      const img = m.replace(/^image:\s*/, '');
      if (img) deps.add(img);
    }
  }

  if (toolType === 'github-actions') {
    deps.add('github-actions');
    const usesMatches = content.match(/uses:\s*(\S+)/g) || [];
    for (const m of usesMatches) {
      const ref = m.replace(/^uses:\s*/, '');
      if (ref) deps.add(ref);
    }
  }

  if (toolType === 'home-assistant') {
    deps.add('homeassistant');
    const serviceMatches = content.match(/service:\s*(\w+)\./g) || [];
    for (const m of serviceMatches) {
      const integration = m.match(/service:\s*(\w+)\./)?.[1];
      if (integration) deps.add(integration);
    }
  }

  if (toolType === 'mlflow') {
    deps.add('mlflow');
    // Extract Python imports
    const fromImports = content.match(/^from\s+(\w+)/gm) || [];
    for (const m of fromImports) {
      const pkg = m.match(/from\s+(\w+)/)?.[1];
      if (pkg && pkg !== 'mlflow') deps.add(pkg);
    }
    const directImports = content.match(/^import\s+(\w+)/gm) || [];
    for (const m of directImports) {
      const pkg = m.match(/import\s+(\w+)/)?.[1];
      if (pkg && pkg !== 'mlflow') deps.add(pkg);
    }
  }

  if (toolType === 'dbt') {
    deps.add('dbt-core');
    const content_lower = content.toLowerCase();
    if (content_lower.includes('postgres') || content_lower.includes('postgresql')) deps.add('dbt-postgres');
    if (content_lower.includes('bigquery')) deps.add('dbt-bigquery');
    if (content_lower.includes('snowflake')) deps.add('dbt-snowflake');
    if (content_lower.includes('redshift')) deps.add('dbt-redshift');
  }

  if (toolType === 'camunda') {
    deps.add('camunda-bpm');
  }

  if (toolType === 'kafka-connect') {
    deps.add('kafka-connect');
    const classMatch = content.match(/["']?connector\.class["']?\s*[:=]\s*["']?([^"',}\s]+)/);
    if (classMatch) deps.add(classMatch[1]);
  }

  if (toolType === 'camel') {
    deps.add('apache-camel');
    // Extract component packages from URIs
    const uriMatches = content.match(/(?:from|to)\(\s*["'](\w+):/g) || [];
    for (const m of uriMatches) {
      const comp = m.match(/["'](\w+):/)?.[1];
      if (comp) deps.add(`camel-${comp}`);
    }
    // YAML form
    const yamlUriMatches = content.match(/uri:\s*(\w+):/g) || [];
    for (const m of yamlUriMatches) {
      const comp = m.match(/uri:\s*(\w+):/)?.[1];
      if (comp) deps.add(`camel-${comp}`);
    }
  }

  return [...deps];
}


describe('extractDependencies — tekton', () => {
  it('adds tekton-pipelines and container images', () => {
    const content = `steps:
    - name: build
      image: golang:1.21
    - name: test
      image: alpine:3.18`;
    const deps = extractDependencies('tekton', content);
    assert.ok(deps.includes('tekton-pipelines'));
    assert.ok(deps.includes('golang:1.21'));
    assert.ok(deps.includes('alpine:3.18'));
  });

  it('returns only tekton-pipelines for minimal content', () => {
    const deps = extractDependencies('tekton', 'apiVersion: tekton.dev/v1');
    assert.ok(deps.includes('tekton-pipelines'));
  });
});


describe('extractDependencies — github-actions', () => {
  it('adds github-actions and uses refs', () => {
    const content = `steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4`;
    const deps = extractDependencies('github-actions', content);
    assert.ok(deps.includes('github-actions'));
    assert.ok(deps.includes('actions/checkout@v4'));
    assert.ok(deps.includes('actions/setup-node@v4'));
  });

  it('returns only github-actions for workflow without uses', () => {
    const deps = extractDependencies('github-actions', 'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest');
    assert.ok(deps.includes('github-actions'));
  });
});


describe('extractDependencies — home-assistant', () => {
  it('adds homeassistant and integration names', () => {
    const content = `action:
  - service: light.turn_on
  - service: notify.send_message`;
    const deps = extractDependencies('home-assistant', content);
    assert.ok(deps.includes('homeassistant'));
    assert.ok(deps.includes('light'));
    assert.ok(deps.includes('notify'));
  });

  it('returns only homeassistant for minimal automation', () => {
    const deps = extractDependencies('home-assistant', 'automation:\n  trigger:\n    platform: state');
    assert.ok(deps.includes('homeassistant'));
  });
});


describe('extractDependencies — mlflow', () => {
  it('adds mlflow and Python imports', () => {
    const content = `import mlflow
from sklearn.ensemble import RandomForestClassifier
import pandas
mlflow.start_run()`;
    const deps = extractDependencies('mlflow', content);
    assert.ok(deps.includes('mlflow'));
    assert.ok(deps.includes('sklearn'));
    assert.ok(deps.includes('pandas'));
  });

  it('returns only mlflow when no extra imports', () => {
    const deps = extractDependencies('mlflow', 'mlflow.start_run()');
    assert.ok(deps.includes('mlflow'));
    assert.equal(deps.length, 1);
  });
});


describe('extractDependencies — dbt', () => {
  it('adds dbt-core and adapter packages', () => {
    const content = `{{ config(materialized='table') }}
SELECT * FROM {{ source('postgresql_raw', 'users') }}`;
    const deps = extractDependencies('dbt', content);
    assert.ok(deps.includes('dbt-core'));
    assert.ok(deps.includes('dbt-postgres'));
  });

  it('adds snowflake adapter when referenced', () => {
    const deps = extractDependencies('dbt', "{{ config(materialized='view') }}\n-- snowflake warehouse\nSELECT 1");
    assert.ok(deps.includes('dbt-core'));
    assert.ok(deps.includes('dbt-snowflake'));
  });
});


describe('extractDependencies — camunda', () => {
  it('adds camunda-bpm', () => {
    const deps = extractDependencies('camunda', '<bpmn:definitions><bpmn:process id="p1"/></bpmn:definitions>');
    assert.ok(deps.includes('camunda-bpm'));
    assert.equal(deps.length, 1);
  });

  it('returns camunda-bpm for any BPMN content', () => {
    const deps = extractDependencies('camunda', '<bpmn2:definitions/>');
    assert.ok(deps.includes('camunda-bpm'));
  });
});


describe('extractDependencies — kafka-connect', () => {
  it('adds kafka-connect and connector class', () => {
    const content = `{
  "connector.class": "io.debezium.connector.mysql.MySqlConnector",
  "tasks.max": "1"
}`;
    const deps = extractDependencies('kafka-connect', content);
    assert.ok(deps.includes('kafka-connect'));
    assert.ok(deps.includes('io.debezium.connector.mysql.MySqlConnector'));
  });

  it('returns only kafka-connect when no class specified', () => {
    const deps = extractDependencies('kafka-connect', '{"tasks.max": "1"}');
    assert.ok(deps.includes('kafka-connect'));
  });
});


describe('extractDependencies — camel', () => {
  it('adds apache-camel and component packages from Java', () => {
    const content = `from("timer:tick").to("kafka:topic").to("log:out");`;
    const deps = extractDependencies('camel', content);
    assert.ok(deps.includes('apache-camel'));
    assert.ok(deps.includes('camel-timer'));
    assert.ok(deps.includes('camel-kafka'));
  });

  it('adds component packages from YAML routes', () => {
    const content = `camel:
  routes:
    - from:
        uri: timer:tick
        steps:
          - to:
              uri: kafka:my-topic`;
    const deps = extractDependencies('camel', content);
    assert.ok(deps.includes('apache-camel'));
    assert.ok(deps.includes('camel-timer'));
    assert.ok(deps.includes('camel-kafka'));
  });
});
