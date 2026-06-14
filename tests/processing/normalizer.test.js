// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkflow } from '../../src/processing/normalizer.js';


describe('normalizeWorkflow — n8n-community', () => {
  const sampleN8n = {
    id: 123,
    name: 'Lead Capture CRM',
    description: 'Captures leads from webhook and stores in CRM',
    user: { username: 'testuser' },
    workflow: {
      nodes: [
        { type: 'n8n-nodes-base.webhook', parameters: {} },
        { type: 'n8n-nodes-base.set', parameters: {} },
        { type: 'n8n-nodes-base.httpRequest', parameters: {}, credentials: { httpHeaderAuth: {} } },
      ],
      connections: {
        Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
        Set: { main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]] },
      },
    },
  };

  it('normalizes n8n-community template', () => {
    const result = normalizeWorkflow('n8n-community', sampleN8n);
    assert.equal(result.source, 'n8n-community');
    assert.equal(result.workflow_name, 'Lead Capture CRM');
    assert.ok(result.id);
    assert.ok(result.hash);
    assert.equal(result.source_url, 'https://n8n.io/workflows/123');
    assert.equal(result.author.username, 'testuser');
  });

  it('populates metadata correctly', () => {
    const result = normalizeWorkflow('n8n-community', sampleN8n);
    assert.equal(result.metadata.node_count, 3);
    assert.equal(result.metadata.connection_count, 2);
    assert.equal(result.metadata.trigger_type, 'webhook');
    assert.ok(result.metadata.node_types.length > 0);
  });

  it('populates quality fields', () => {
    const result = normalizeWorkflow('n8n-community', sampleN8n);
    assert.equal(result.quality.has_description, true);
    assert.equal(result.quality.is_complete, true);
    assert.equal(result.quality.validation_status, 'valid');
  });
});


describe('normalizeWorkflow — github', () => {
  const sampleGithub = {
    searchResult: {
      html_url: 'https://github.com/user/repo/blob/main/workflow.json',
      sha: 'abc123',
      path: 'workflows/email-parser.json',
      repository: {
        full_name: 'user/repo',
        owner: { login: 'user', html_url: 'https://github.com/user' },
        stargazers_count: 42,
      },
    },
    workflowJson: {
      name: 'Email Parser',
      nodes: [
        { type: 'n8n-nodes-base.emailTrigger', parameters: {} },
        { type: 'n8n-nodes-base.code', parameters: {} },
      ],
      connections: {},
    },
  };

  it('normalizes GitHub workflow', () => {
    const result = normalizeWorkflow('github', sampleGithub);
    assert.equal(result.source, 'github');
    assert.equal(result.workflow_name, 'Email Parser');
    assert.equal(result.author.username, 'user');
    assert.equal(result.metadata.github_stars, 42);
  });
});


describe('normalizeWorkflow — reddit', () => {
  const sampleReddit = {
    post: {
      id: 'r123',
      permalink: '/r/n8n/comments/r123/my_workflow/',
      title: 'My awesome workflow',
      author: 'redditor42',
      score: 100,
      num_comments: 15,
    },
    workflowJson: {
      nodes: [{ type: 'n8n-nodes-base.set' }],
      connections: {},
    },
    context: 'body',
  };

  it('normalizes Reddit workflow', () => {
    const result = normalizeWorkflow('reddit', sampleReddit);
    assert.equal(result.source, 'reddit');
    assert.equal(result.author.username, 'redditor42');
    assert.equal(result.metadata.reddit_score, 100);
    assert.equal(result.metadata.reddit_comments, 15);
    assert.ok(result.source_url.includes('reddit.com'));
  });
});


describe('normalizeWorkflow — unknown source', () => {
  it('throws for unknown source', () => {
    assert.throws(
      () => normalizeWorkflow('foobar', {}),
      { message: /Unknown source: foobar/ }
    );
  });
});


describe('normalizeWorkflow — github-agents (langchain)', () => {
  const sampleAgent = {
    searchResult: {
      html_url: 'https://github.com/user/repo/blob/main/agent.py',
      sha: 'def456',
      path: 'agents/rag-agent.py',
      repository: {
        full_name: 'user/repo',
        owner: { login: 'user', html_url: 'https://github.com/user' },
        stargazers_count: 10,
      },
    },
    content: `
from langchain import OpenAI
from langchain.agents import Tool
agent = Tool(name="search", func=search)
llm = ChatOpenAI()
    `,
    framework: 'langchain',
    filename: 'agent.py',
  };

  it('normalizes agent framework code', () => {
    const result = normalizeWorkflow('github-agents', sampleAgent);
    assert.equal(result.source, 'github-agents');
    assert.equal(result.tool_type, 'langchain');
    assert.ok(result.tool_metadata.components.length > 0);
    assert.equal(result.tool_metadata.model_provider, 'openai');
  });
});


describe('normalizeWorkflow — activepieces', () => {
  const sampleAP = {
    template: {
      id: 'ap-123',
      name: 'Gmail to Slack',
      description: 'Forward Gmail emails to Slack channel',
      trigger: {
        type: 'PIECE_TRIGGER',
        pieceName: 'gmail',
        nextAction: {
          type: 'PIECE',
          pieceName: 'slack',
        },
      },
    },
  };

  it('normalizes activepieces template', () => {
    const result = normalizeWorkflow('activepieces', sampleAP);
    assert.equal(result.source, 'activepieces');
    assert.equal(result.workflow_name, 'Gmail to Slack');
    assert.equal(result.tool_type, 'activepieces');
    assert.ok(result.tool_metadata.pieces.includes('gmail'));
    assert.ok(result.tool_metadata.pieces.includes('slack'));
  });
});
