// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import 'dotenv/config';

const optional = (key, fallback) => process.env[key] || fallback;

export const config = Object.freeze({
  db: {
    host: optional('PG_HOST', 'localhost'),
    port: parseInt(optional('PG_PORT', '5435'), 10),
    database: optional('PG_DATABASE', 'workflow_library'),
    user: optional('PG_USER', 'harvester'),
    password: optional('PG_PASSWORD', ''),
  },
  github: {
    token: optional('GITHUB_TOKEN', ''),
    webhookSecret: optional('GITHUB_WEBHOOK_SECRET', ''),
  },
  reddit: {
    clientId: optional('REDDIT_CLIENT_ID', ''),
    clientSecret: optional('REDDIT_CLIENT_SECRET', ''),
  },
  ollama: {
    host: optional('OLLAMA_HOST', 'http://localhost:11434'),
    model: optional('OLLAMA_MODEL', 'qwen2.5:7b'),
    embedModel: optional('OLLAMA_EMBED_MODEL', 'nomic-embed-text'),
  },
  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY', ''),
    model: optional('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001'),
  },
  trendscope: {
    baseUrl: optional('TRENDSCOPE_BASE_URL', 'http://localhost:8009'),
  },
  nexus: {
    baseUrl: optional('NEXUS_BASE_URL', 'http://localhost:8008'),
    enabled: optional('NEXUS_PUBLISHER_ENABLED', 'true') === 'true',
  },
});
