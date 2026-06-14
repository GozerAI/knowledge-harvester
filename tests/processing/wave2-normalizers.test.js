// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// Tekton — extractTektonComponents (reimplemented)
// ============================================================

function extractTektonComponents(content) {
  if (!content || typeof content !== 'string') return { tasks: [], images: [], params: [] };
  const tasks = [];
  const images = [];
  const params = [];
  const taskMatches = content.match(/name:\s*(\S+)/g) || [];
  for (const m of taskMatches) {
    const name = m.replace(/^name:\s*/, '');
    if (name && !tasks.includes(name)) tasks.push(name);
  }
  const imageMatches = content.match(/image:\s*(\S+)/g) || [];
  for (const m of imageMatches) {
    const img = m.replace(/^image:\s*/, '');
    if (img && !images.includes(img)) images.push(img);
  }
  const paramMatches = content.match(/- name:\s*(\S+)/g) || [];
  for (const m of paramMatches) {
    const p = m.replace(/^- name:\s*/, '');
    if (p && !params.includes(p)) params.push(p);
  }
  return { tasks, images, params };
}

describe('extractTektonComponents', () => {
  it('extracts task names, images, and params from valid YAML', () => {
    const content = `apiVersion: tekton.dev/v1beta1
kind: Task
metadata:
  name: build-task
spec:
  params:
    - name: repo-url
    - name: revision
  steps:
    - name: clone
      image: alpine/git
    - name: build
      image: golang:1.21`;
    const result = extractTektonComponents(content);
    assert.ok(result.tasks.includes('build-task'));
    assert.ok(result.images.includes('alpine/git'));
    assert.ok(result.images.includes('golang:1.21'));
    assert.ok(result.params.includes('repo-url'));
  });

  it('returns empty arrays for empty input', () => {
    const result = extractTektonComponents('');
    assert.deepEqual(result, { tasks: [], images: [], params: [] });
  });

  it('returns empty arrays for null input', () => {
    const result = extractTektonComponents(null);
    assert.deepEqual(result, { tasks: [], images: [], params: [] });
  });

  it('handles multiple tasks', () => {
    const content = `metadata:
  name: task-one
---
metadata:
  name: task-two
spec:
  steps:
    - name: step-a
      image: node:18`;
    const result = extractTektonComponents(content);
    assert.ok(result.tasks.includes('task-one'));
    assert.ok(result.tasks.includes('task-two'));
  });
});


// ============================================================
// GitHub Actions — extractGitHubActionsComponents (reimplemented)
// ============================================================

function extractGitHubActionsComponents(content) {
  if (!content || typeof content !== 'string') return { actions: [], jobs: [], triggers: [] };
  const actions = [];
  const jobs = [];
  const triggers = [];
  const usesMatches = content.match(/uses:\s*(\S+)/g) || [];
  for (const m of usesMatches) {
    const action = m.replace(/^uses:\s*/, '');
    if (action && !actions.includes(action)) actions.push(action);
  }
  const jobSection = content.match(/^jobs:\s*\n([\s\S]*?)(?=^[a-z]|\Z)/m);
  const jobMatches = content.match(/^\s{2}(\w[\w-]*):\s*$/gm) || [];
  for (const m of jobMatches) {
    const job = m.trim().replace(/:$/, '');
    if (job && job !== 'jobs' && job !== 'on' && job !== 'steps' && !jobs.includes(job)) jobs.push(job);
  }
  const onBlock = content.match(/^on:\s*\n([\s\S]*?)(?=^[a-z])/m);
  if (onBlock) {
    const triggerMatches = onBlock[1].match(/^\s{2}(\w[\w-]*):/gm) || [];
    for (const m of triggerMatches) {
      const trigger = m.trim().replace(/:$/, '');
      if (trigger && !triggers.includes(trigger)) triggers.push(trigger);
    }
  }
  // Inline on: form
  const inlineOn = content.match(/^on:\s*\[([^\]]+)\]/m);
  if (inlineOn) {
    for (const t of inlineOn[1].split(',')) {
      const trigger = t.trim();
      if (trigger && !triggers.includes(trigger)) triggers.push(trigger);
    }
  }
  return { actions, jobs, triggers };
}

describe('extractGitHubActionsComponents', () => {
  it('extracts actions, jobs, and triggers from valid workflow', () => {
    const content = `name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4`;
    const result = extractGitHubActionsComponents(content);
    assert.ok(result.actions.includes('actions/checkout@v4'));
    assert.ok(result.actions.includes('actions/setup-node@v4'));
    assert.ok(result.triggers.includes('push'));
    assert.ok(result.triggers.includes('pull_request'));
  });

  it('returns empty arrays for empty input', () => {
    const result = extractGitHubActionsComponents('');
    assert.deepEqual(result, { actions: [], jobs: [], triggers: [] });
  });

  it('handles multiple jobs', () => {
    const content = `on: [push]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4`;
    const result = extractGitHubActionsComponents(content);
    assert.ok(result.jobs.length >= 2);
  });

  it('handles inline on: trigger syntax', () => {
    const content = `on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest`;
    const result = extractGitHubActionsComponents(content);
    assert.ok(result.triggers.includes('push'));
    assert.ok(result.triggers.includes('pull_request'));
  });
});


// ============================================================
// Home Assistant — extractHomeAssistantComponents (reimplemented)
// ============================================================

function extractHomeAssistantComponents(content) {
  if (!content || typeof content !== 'string') return { triggers: [], services: [], integrations: [] };
  const triggers = [];
  const services = [];
  const integrations = [];
  const triggerMatches = content.match(/platform:\s*(\S+)/g) || [];
  for (const m of triggerMatches) {
    const platform = m.replace(/^platform:\s*/, '');
    if (platform && !triggers.includes(platform)) triggers.push(platform);
  }
  const serviceMatches = content.match(/service:\s*(\S+)/g) || [];
  for (const m of serviceMatches) {
    const svc = m.replace(/^service:\s*/, '');
    if (svc && !services.includes(svc)) services.push(svc);
    const integration = svc.split('.')[0];
    if (integration && !integrations.includes(integration)) integrations.push(integration);
  }
  return { triggers, services, integrations };
}

describe('extractHomeAssistantComponents', () => {
  it('extracts triggers, services, and integrations', () => {
    const content = `automation:
  trigger:
    - platform: state
      entity_id: binary_sensor.motion
  action:
    - service: light.turn_on
      entity_id: light.living_room
    - service: notify.mobile_app`;
    const result = extractHomeAssistantComponents(content);
    assert.ok(result.triggers.includes('state'));
    assert.ok(result.services.includes('light.turn_on'));
    assert.ok(result.integrations.includes('light'));
    assert.ok(result.integrations.includes('notify'));
  });

  it('returns empty arrays for empty input', () => {
    const result = extractHomeAssistantComponents('');
    assert.deepEqual(result, { triggers: [], services: [], integrations: [] });
  });

  it('handles multiple triggers', () => {
    const content = `trigger:
  - platform: state
    entity_id: sensor.temp
  - platform: time
    at: "08:00:00"
  - platform: mqtt
    topic: home/status`;
    const result = extractHomeAssistantComponents(content);
    assert.ok(result.triggers.length >= 3);
  });

  it('deduplicates integrations from multiple services', () => {
    const content = `action:
  - service: light.turn_on
  - service: light.turn_off
  - service: switch.toggle`;
    const result = extractHomeAssistantComponents(content);
    assert.equal(result.integrations.filter(i => i === 'light').length, 1);
  });
});


// ============================================================
// MLflow — extractMlflowComponents (reimplemented)
// ============================================================

function extractMlflowComponents(content) {
  if (!content || typeof content !== 'string') return { experiments: [], metrics: [], flavors: [] };
  const experiments = [];
  const metrics = [];
  const flavors = [];
  const expMatches = content.match(/set_experiment\(["']([^"']+)["']\)/g) || [];
  for (const m of expMatches) {
    const exp = m.match(/set_experiment\(["']([^"']+)["']\)/)?.[1];
    if (exp && !experiments.includes(exp)) experiments.push(exp);
  }
  const metricMatches = content.match(/log_metric\(["']([^"']+)["']/g) || [];
  for (const m of metricMatches) {
    const metric = m.match(/log_metric\(["']([^"']+)["']/)?.[1];
    if (metric && !metrics.includes(metric)) metrics.push(metric);
  }
  const flavorList = ['sklearn', 'pytorch', 'tensorflow', 'xgboost', 'lightgbm', 'transformers', 'langchain', 'openai', 'pyfunc'];
  for (const f of flavorList) {
    if (content.includes(`mlflow.${f}`)) flavors.push(f);
  }
  return { experiments, metrics, flavors };
}

describe('extractMlflowComponents', () => {
  it('extracts experiments, metrics, and model flavors', () => {
    const content = `import mlflow
mlflow.set_experiment("my-experiment")
with mlflow.start_run():
    mlflow.log_metric("accuracy", 0.95)
    mlflow.log_metric("loss", 0.05)
    mlflow.sklearn.log_model(model, "model")`;
    const result = extractMlflowComponents(content);
    assert.ok(result.experiments.includes('my-experiment'));
    assert.ok(result.metrics.includes('accuracy'));
    assert.ok(result.metrics.includes('loss'));
    assert.ok(result.flavors.includes('sklearn'));
  });

  it('returns empty arrays for empty input', () => {
    const result = extractMlflowComponents('');
    assert.deepEqual(result, { experiments: [], metrics: [], flavors: [] });
  });

  it('handles multiple flavors', () => {
    const content = `import mlflow.pytorch
import mlflow.transformers
mlflow.pytorch.log_model(model, "pytorch-model")
mlflow.transformers.log_model(pipe, "hf-model")`;
    const result = extractMlflowComponents(content);
    assert.ok(result.flavors.includes('pytorch'));
    assert.ok(result.flavors.includes('transformers'));
  });

  it('returns empty for Python code without mlflow patterns', () => {
    const content = `import pandas as pd
df = pd.read_csv("data.csv")
print(df.describe())`;
    const result = extractMlflowComponents(content);
    assert.equal(result.experiments.length, 0);
    assert.equal(result.metrics.length, 0);
    assert.equal(result.flavors.length, 0);
  });
});


// ============================================================
// dbt — extractDbtComponents (reimplemented)
// ============================================================

function extractDbtComponents(content) {
  if (!content || typeof content !== 'string') return { refs: [], sources: [], materialization: null };
  const refs = [];
  const sources = [];
  let materialization = null;
  const refMatches = content.match(/\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g) || [];
  for (const m of refMatches) {
    const ref = m.match(/ref\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  const sourceMatches = content.match(/\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g) || [];
  for (const m of sourceMatches) {
    const parts = m.match(/source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (parts) {
      const src = `${parts[1]}.${parts[2]}`;
      if (!sources.includes(src)) sources.push(src);
    }
  }
  const matMatch = content.match(/materialized\s*=\s*['"](\w+)['"]/);
  if (matMatch) materialization = matMatch[1];
  return { refs, sources, materialization };
}

describe('extractDbtComponents', () => {
  it('extracts refs, sources, and materialization', () => {
    const content = `{{ config(materialized='table') }}
SELECT
    o.id,
    o.amount,
    c.name
FROM {{ ref('stg_orders') }} o
JOIN {{ ref('stg_customers') }} c ON o.customer_id = c.id
WHERE o.source_system IN (SELECT id FROM {{ source('raw', 'systems') }})`;
    const result = extractDbtComponents(content);
    assert.ok(result.refs.includes('stg_orders'));
    assert.ok(result.refs.includes('stg_customers'));
    assert.ok(result.sources.includes('raw.systems'));
    assert.equal(result.materialization, 'table');
  });

  it('returns empty for empty input', () => {
    const result = extractDbtComponents('');
    assert.deepEqual(result, { refs: [], sources: [], materialization: null });
  });

  it('handles multiple refs without duplicates', () => {
    const content = `SELECT * FROM {{ ref('dim_users') }}
UNION ALL
SELECT * FROM {{ ref('dim_users') }}
UNION ALL
SELECT * FROM {{ ref('dim_orders') }}`;
    const result = extractDbtComponents(content);
    assert.equal(result.refs.filter(r => r === 'dim_users').length, 1);
    assert.ok(result.refs.includes('dim_orders'));
  });

  it('returns null materialization when not specified', () => {
    const content = `SELECT * FROM {{ ref('stg_data') }}`;
    const result = extractDbtComponents(content);
    assert.equal(result.materialization, null);
  });
});


// ============================================================
// Camunda — extractCamundaComponents (reimplemented)
// ============================================================

function extractCamundaComponents(content) {
  if (!content || typeof content !== 'string') return { elementTypes: [] };
  const elementTypes = [];
  const bpmnElements = [
    'startEvent', 'endEvent', 'userTask', 'serviceTask', 'scriptTask',
    'exclusiveGateway', 'parallelGateway', 'intermediateCatchEvent',
    'boundaryEvent', 'subProcess', 'callActivity', 'sendTask', 'receiveTask',
  ];
  for (const el of bpmnElements) {
    const pattern = new RegExp(`<bpmn:?2?:${el}\\b`, 'i');
    if (pattern.test(content) && !elementTypes.includes(el)) {
      elementTypes.push(el);
    }
  }
  return { elementTypes };
}

describe('extractCamundaComponents', () => {
  it('extracts BPMN element types', () => {
    const content = `<bpmn:definitions>
  <bpmn:process id="Process_1">
    <bpmn:startEvent id="Start_1"/>
    <bpmn:userTask id="Task_1" name="Review"/>
    <bpmn:serviceTask id="Task_2" name="Process"/>
    <bpmn:exclusiveGateway id="Gateway_1"/>
    <bpmn:endEvent id="End_1"/>
  </bpmn:process>
</bpmn:definitions>`;
    const result = extractCamundaComponents(content);
    assert.ok(result.elementTypes.includes('startEvent'));
    assert.ok(result.elementTypes.includes('userTask'));
    assert.ok(result.elementTypes.includes('serviceTask'));
    assert.ok(result.elementTypes.includes('exclusiveGateway'));
    assert.ok(result.elementTypes.includes('endEvent'));
  });

  it('returns empty for empty input', () => {
    const result = extractCamundaComponents('');
    assert.deepEqual(result, { elementTypes: [] });
  });

  it('returns empty for non-BPMN XML', () => {
    const result = extractCamundaComponents('<root><element>data</element></root>');
    assert.equal(result.elementTypes.length, 0);
  });

  it('handles bpmn2: namespace prefix', () => {
    const content = `<bpmn2:definitions>
  <bpmn2:startEvent id="Start"/>
  <bpmn2:parallelGateway id="PG"/>
</bpmn2:definitions>`;
    const result = extractCamundaComponents(content);
    assert.ok(result.elementTypes.includes('startEvent'));
    assert.ok(result.elementTypes.includes('parallelGateway'));
  });
});


// ============================================================
// Kafka Connect — extractKafkaConnectComponents (reimplemented)
// ============================================================

function extractKafkaConnectComponents(content) {
  if (!content || typeof content !== 'string') return { connectorClass: null, topics: [] };
  let connectorClass = null;
  const topics = [];
  const classMatch = content.match(/["']?connector\.class["']?\s*[:=]\s*["']?([^"',}\s]+)/);
  if (classMatch) connectorClass = classMatch[1];
  const topicsMatch = content.match(/["']?topics["']?\s*[:=]\s*["']?([^"'}\n]+)/);
  if (topicsMatch) {
    for (const t of topicsMatch[1].split(',')) {
      const topic = t.trim().replace(/["']/g, '');
      if (topic && !topics.includes(topic)) topics.push(topic);
    }
  }
  return { connectorClass, topics };
}

describe('extractKafkaConnectComponents', () => {
  it('extracts connector class and topics', () => {
    const content = `{
  "connector.class": "io.debezium.connector.mysql.MySqlConnector",
  "tasks.max": "1",
  "topics": "inventory.orders,inventory.products"
}`;
    const result = extractKafkaConnectComponents(content);
    assert.equal(result.connectorClass, 'io.debezium.connector.mysql.MySqlConnector');
    assert.ok(result.topics.includes('inventory.orders'));
    assert.ok(result.topics.includes('inventory.products'));
  });

  it('returns null/empty for empty input', () => {
    const result = extractKafkaConnectComponents('');
    assert.equal(result.connectorClass, null);
    assert.deepEqual(result.topics, []);
  });

  it('handles properties file format', () => {
    const content = `connector.class=org.apache.kafka.connect.file.FileStreamSinkConnector
topics=test-topic
tasks.max=1`;
    const result = extractKafkaConnectComponents(content);
    assert.equal(result.connectorClass, 'org.apache.kafka.connect.file.FileStreamSinkConnector');
    assert.ok(result.topics.includes('test-topic'));
  });

  it('handles single topic', () => {
    const content = `{
  "connector.class": "com.example.Connector",
  "topics": "single-topic"
}`;
    const result = extractKafkaConnectComponents(content);
    assert.equal(result.topics.length, 1);
    assert.equal(result.topics[0], 'single-topic');
  });
});


// ============================================================
// Camel — extractCamelComponents (reimplemented)
// ============================================================

function extractCamelComponents(content) {
  if (!content || typeof content !== 'string') return { components: [], eipPatterns: [] };
  const components = [];
  const eipPatterns = [];
  const fromMatches = content.match(/from\(\s*["'](\w+):/g) || [];
  for (const m of fromMatches) {
    const comp = m.match(/from\(\s*["'](\w+):/)?.[1];
    if (comp && !components.includes(comp)) components.push(comp);
  }
  const toMatches = content.match(/\.to\(\s*["'](\w+):/g) || [];
  for (const m of toMatches) {
    const comp = m.match(/\.to\(\s*["'](\w+):/)?.[1];
    if (comp && !components.includes(comp)) components.push(comp);
  }
  // YAML form
  const yamlFromMatches = content.match(/uri:\s*(\w+):/g) || [];
  for (const m of yamlFromMatches) {
    const comp = m.match(/uri:\s*(\w+):/)?.[1];
    if (comp && !components.includes(comp)) components.push(comp);
  }
  const eips = ['split', 'aggregate', 'filter', 'choice', 'multicast', 'recipientList', 'routingSlip', 'wireTap', 'enrich', 'pollEnrich'];
  for (const eip of eips) {
    if (content.includes(`.${eip}(`) || content.includes(`${eip}:`)) {
      if (!eipPatterns.includes(eip)) eipPatterns.push(eip);
    }
  }
  return { components, eipPatterns };
}

describe('extractCamelComponents', () => {
  it('extracts route components and EIP patterns from Java', () => {
    const content = `public class MyRoute extends RouteBuilder {
  public void configure() {
    from("timer:tick")
      .split(body())
      .to("kafka:output-topic")
      .to("log:processed");
  }
}`;
    const result = extractCamelComponents(content);
    assert.ok(result.components.includes('timer'));
    assert.ok(result.components.includes('kafka'));
    assert.ok(result.eipPatterns.includes('split'));
  });

  it('returns empty for empty input', () => {
    const result = extractCamelComponents('');
    assert.deepEqual(result, { components: [], eipPatterns: [] });
  });

  it('extracts components from YAML routes', () => {
    const content = `camel:
  routes:
    - from:
        uri: timer:tick
        steps:
          - to:
              uri: kafka:my-topic
          - to:
              uri: log:info`;
    const result = extractCamelComponents(content);
    assert.ok(result.components.includes('timer'));
    assert.ok(result.components.includes('kafka'));
  });

  it('detects multiple EIP patterns', () => {
    const content = `from("direct:start")
  .filter(header("type").isEqualTo("A"))
  .choice()
    .when(simple("\${body} > 100"))
      .to("direct:high")
    .otherwise()
      .to("direct:low")
  .aggregate(constant(true), new MyStrategy())
  .to("seda:result");`;
    const result = extractCamelComponents(content);
    assert.ok(result.eipPatterns.includes('filter'));
    assert.ok(result.eipPatterns.includes('choice'));
    assert.ok(result.eipPatterns.includes('aggregate'));
  });
});
