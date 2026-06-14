// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ============================================================
// Tekton Harvester — validate (reimplemented)
// ============================================================

function validateTekton(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  if (ext !== 'yaml' && ext !== 'yml') return false;
  return content.includes('apiVersion') && content.includes('tekton.dev');
}

describe('TektonHarvester — validation', () => {
  it('returns true for valid Tekton pipeline YAML', () => {
    assert.ok(validateTekton('pipeline.yaml', 'apiVersion: tekton.dev/v1beta1\nkind: Pipeline'));
  });

  it('returns false for wrong file extension', () => {
    assert.equal(validateTekton('pipeline.json', 'apiVersion: tekton.dev/v1beta1\nkind: Pipeline'), false);
  });

  it('returns false for missing tekton.dev marker', () => {
    assert.equal(validateTekton('pipeline.yaml', 'apiVersion: apps/v1\nkind: Deployment'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateTekton('pipeline.yaml', ''), false);
  });

  it('returns true for .yml extension', () => {
    assert.ok(validateTekton('task.yml', 'apiVersion: tekton.dev/v1\nkind: Task'));
  });

  it('returns false for YAML without apiVersion', () => {
    assert.equal(validateTekton('pipeline.yaml', 'kind: Pipeline\ntekton.dev/v1beta1'), false);
  });
});


// ============================================================
// GitHub Actions Harvester — validate (reimplemented)
// ============================================================

function validateGitHubActions(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  if (ext !== 'yml' && ext !== 'yaml') return false;
  const isWorkflow = content.includes('on:') && content.includes('jobs:');
  const isAction = content.includes('runs:') && content.includes('using:');
  return isWorkflow || isAction;
}

describe('GitHubActionsHarvester — validation', () => {
  it('returns true for valid workflow YAML with on: and jobs:', () => {
    assert.ok(validateGitHubActions('ci.yml', 'on:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest'));
  });

  it('returns false for wrong file extension', () => {
    assert.equal(validateGitHubActions('ci.json', 'on:\n  push:\njobs:\n  build:'), false);
  });

  it('returns false for YAML missing both patterns', () => {
    assert.equal(validateGitHubActions('ci.yml', 'name: CI\nsteps:\n  - run: echo hello'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateGitHubActions('ci.yml', ''), false);
  });

  it('returns true for composite action with runs: and using:', () => {
    assert.ok(validateGitHubActions('action.yaml', 'name: My Action\nruns:\n  using: composite\n  steps:'));
  });

  it('returns false for YAML with only on: but no jobs:', () => {
    assert.equal(validateGitHubActions('ci.yml', 'on:\n  push:\nsteps:\n  - run: echo'), false);
  });
});


// ============================================================
// Home Assistant Harvester — validate (reimplemented)
// ============================================================

function validateHomeAssistant(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  if (ext !== 'yaml' && ext !== 'yml') return false;
  const hasType = content.includes('automation:') || content.includes('blueprint:');
  const hasLogic = content.includes('trigger:') || content.includes('action:');
  return hasType && hasLogic;
}

describe('HomeAssistantHarvester — validation', () => {
  it('returns true for automation with trigger', () => {
    assert.ok(validateHomeAssistant('auto.yaml', 'automation:\n  trigger:\n    platform: state'));
  });

  it('returns false for wrong file extension', () => {
    assert.equal(validateHomeAssistant('auto.json', 'automation:\n  trigger:\n    platform: state'), false);
  });

  it('returns false for YAML missing trigger/action', () => {
    assert.equal(validateHomeAssistant('auto.yaml', 'automation:\n  alias: My Auto'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateHomeAssistant('auto.yaml', ''), false);
  });

  it('returns true for blueprint with action', () => {
    assert.ok(validateHomeAssistant('bp.yml', 'blueprint:\n  name: My BP\n  action:\n    service: light.turn_on'));
  });

  it('returns false for YAML with trigger but no automation/blueprint', () => {
    assert.equal(validateHomeAssistant('auto.yaml', 'script:\n  trigger:\n    platform: time'), false);
  });
});


// ============================================================
// MLflow Harvester — validate (reimplemented)
// ============================================================

function validateMlflow(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  const basename = filename.split('/').pop().split('\\').pop();
  if (ext === 'py') {
    return content.includes('mlflow.');
  }
  if (basename === 'MLproject') {
    return content.includes('entry_points');
  }
  return false;
}

describe('MLflowHarvester — validation', () => {
  it('returns true for .py file with mlflow. usage', () => {
    assert.ok(validateMlflow('train.py', 'import mlflow\nmlflow.start_run()\nmlflow.log_metric("acc", 0.95)'));
  });

  it('returns false for wrong file extension', () => {
    assert.equal(validateMlflow('train.js', 'mlflow.start_run()'), false);
  });

  it('returns false for .py file without mlflow marker', () => {
    assert.equal(validateMlflow('train.py', 'import pandas\ndf = pandas.read_csv("data.csv")'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateMlflow('train.py', ''), false);
  });

  it('returns true for MLproject file with entry_points', () => {
    assert.ok(validateMlflow('MLproject', 'name: my-project\nentry_points:\n  main:\n    command: python train.py'));
  });

  it('returns false for MLproject without entry_points', () => {
    assert.equal(validateMlflow('MLproject', 'name: my-project\nconda_env: conda.yaml'), false);
  });
});


// ============================================================
// dbt Harvester — validate (reimplemented)
// ============================================================

function validateDbt(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  const basename = filename.split('/').pop().split('\\').pop();
  if (ext === 'sql') {
    return content.includes('{{ config(') || content.includes('{{ ref(') || content.includes('{{ source(');
  }
  if (basename === 'dbt_project.yml') {
    return content.includes('name:');
  }
  return false;
}

describe('DbtHarvester — validation', () => {
  it('returns true for .sql with {{ config( jinja', () => {
    assert.ok(validateDbt('model.sql', "{{ config(materialized='table') }}\nSELECT * FROM {{ ref('stg_orders') }}"));
  });

  it('returns false for wrong file extension', () => {
    assert.equal(validateDbt('model.py', "{{ config(materialized='table') }}"), false);
  });

  it('returns false for plain SQL without dbt markers', () => {
    assert.equal(validateDbt('query.sql', 'SELECT * FROM users WHERE active = true'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateDbt('model.sql', ''), false);
  });

  it('returns true for dbt_project.yml with name:', () => {
    assert.ok(validateDbt('dbt_project.yml', "name: 'my_project'\nversion: '1.0.0'\nprofile: 'default'"));
  });

  it('returns false for .sql with similar but incorrect jinja', () => {
    assert.equal(validateDbt('model.sql', '{{ configuration(materialized) }}\nSELECT 1'), false);
  });
});


// ============================================================
// Camunda Harvester — validate (reimplemented)
// ============================================================

function validateCamunda(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  if (ext !== 'bpmn' && ext !== 'xml') return false;
  return content.includes('bpmn:definitions') || content.includes('bpmn2:definitions');
}

describe('CamundaHarvester — validation', () => {
  it('returns true for .bpmn with bpmn:definitions', () => {
    assert.ok(validateCamunda('process.bpmn', '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">'));
  });

  it('returns false for wrong file extension', () => {
    assert.equal(validateCamunda('process.json', '<bpmn:definitions>'), false);
  });

  it('returns false for XML without bpmn definitions', () => {
    assert.equal(validateCamunda('process.xml', '<root><element>data</element></root>'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateCamunda('process.bpmn', ''), false);
  });

  it('returns true for .xml with bpmn2:definitions', () => {
    assert.ok(validateCamunda('process.xml', '<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL">'));
  });

  it('returns false for bpmn file with bpmn3:definitions (non-standard)', () => {
    assert.equal(validateCamunda('process.bpmn', '<bpmn3:definitions xmlns:bpmn3="http://custom">'), false);
  });
});


// ============================================================
// Kafka Connect Harvester — validate (reimplemented)
// ============================================================

function validateKafkaConnect(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!content.includes('connector.class')) return false;
  return content.includes('tasks.max') || content.includes('topics');
}

describe('KafkaConnectHarvester — validation', () => {
  it('returns true for config with connector.class and tasks.max', () => {
    assert.ok(validateKafkaConnect('connector.json', '{"connector.class":"io.debezium.connector.mysql.MySqlConnector","tasks.max":"1"}'));
  });

  it('returns false for wrong content (no connector.class)', () => {
    assert.equal(validateKafkaConnect('config.json', '{"tasks.max":"1","topics":"my-topic"}'), false);
  });

  it('returns false for connector.class without tasks.max or topics', () => {
    assert.equal(validateKafkaConnect('config.json', '{"connector.class":"com.example.Connector","name":"test"}'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateKafkaConnect('config.json', ''), false);
  });

  it('returns true for config with connector.class and topics', () => {
    assert.ok(validateKafkaConnect('connector.properties', 'connector.class=org.apache.kafka.connect.file.FileStreamSinkConnector\ntopics=test-topic'));
  });

  it('returns false for null content', () => {
    assert.equal(validateKafkaConnect('config.json', null), false);
  });
});


// ============================================================
// Camel Harvester — validate (reimplemented)
// ============================================================

function validateCamel(filename, content) {
  if (!content || typeof content !== 'string') return false;
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'java') {
    return content.includes('RouteBuilder') || content.includes('from(');
  }
  if (ext === 'yaml' || ext === 'yml') {
    return content.includes('camel:') && content.includes('from:');
  }
  return false;
}

describe('CamelHarvester — validation', () => {
  it('returns true for .java with RouteBuilder', () => {
    assert.ok(validateCamel('MyRoute.java', 'public class MyRoute extends RouteBuilder {\n  public void configure() {\n    from("timer:tick").to("log:hello");\n  }\n}'));
  });

  it('returns false for wrong file extension', () => {
    assert.equal(validateCamel('route.py', 'RouteBuilder from('), false);
  });

  it('returns false for .java without Camel markers', () => {
    assert.equal(validateCamel('App.java', 'public class App {\n  public static void main(String[] args) {}\n}'), false);
  });

  it('returns false for empty content', () => {
    assert.equal(validateCamel('route.java', ''), false);
  });

  it('returns true for .yaml with camel: and from:', () => {
    assert.ok(validateCamel('route.yaml', 'camel:\n  routes:\n    - from:\n        uri: timer:tick\n        steps:\n          - to: log:hello'));
  });

  it('returns false for .yaml with camel: but no from:', () => {
    assert.equal(validateCamel('route.yaml', 'camel:\n  routes:\n    - to:\n        uri: log:hello'), false);
  });
});
