// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Trendscope HTTP client for Knowledge Harvester.
 *
 * Uses Node built-in http/https — no external dependencies.
 * Graceful degradation: returns empty data if Trendscope is unreachable.
 */

import { logger } from '../utils/logger.js';
import { RetryPolicy, getCircuitBreaker, resilientFetch } from '../utils/resilience.js';

const BASE_URL = process.env.TRENDSCOPE_BASE_URL || 'http://localhost:8009';

const tsBreaker = getCircuitBreaker('trendscope', { failureThreshold: 3, recoveryTimeout: 120000 });
const tsRetry = new RetryPolicy({ maxRetries: 2, baseDelay: 1000 });

// KH category → TS category mapping
export const CATEGORY_MAP = {
  'ai-agent': 'technology',
  'ai-image-generation': 'technology',
  'ml-data-ops': 'technology',
  'streaming-realtime': 'technology',
  'ci-cd-pipeline': 'technology',
  'devops-monitoring': 'technology',
  'infrastructure-as-code': 'technology',
  'security-automation': 'technology',
  'ecommerce': 'ecommerce',
  'lead-gen-crm': 'business',
  'finance-accounting': 'business',
  'business-process': 'business',
  'customer-support': 'consumer',
  'general-productivity': 'consumer',
  'iot-home-automation': 'consumer',
  'data-pipeline': 'niche_market',
  'data-processing': 'niche_market',
  'orchestration': 'niche_market',
  'integration-pipeline': 'niche_market',
  'multi-step-automation': 'emerging',
  'content-marketing': 'emerging',
};

/**
 * Make an HTTP GET request and return parsed JSON.
 * Uses resilient fetch with retry + circuit breaker.
 * Returns null on any failure (graceful degradation).
 */
async function request(urlPath, timeout = 5000) {
  try {
    const fullUrl = new URL(urlPath, BASE_URL).href;
    const result = await resilientFetch(fullUrl, {
      timeout,
      retryPolicy: tsRetry,
      circuitBreaker: tsBreaker,
    });
    return result;
  } catch (err) {
    logger.debug(`Trendscope request failed: ${err.message}`);
    return null;
  }
}

/**
 * Get buy/sell signals from Trendscope.
 * @returns {Promise<object|null>} Signal data grouped by signal type, or null on failure.
 */
export async function getSignals() {
  return request('/v1/signals');
}

/**
 * Get top trends from Trendscope.
 * @param {number} [limit=20]
 * @returns {Promise<Array|null>}
 */
export async function getTopTrends(limit = 20) {
  return request(`/v1/trends/top?limit=${limit}`);
}

/**
 * Search trends by query string.
 * @param {string} q
 * @param {number} [limit=20]
 * @returns {Promise<Array|null>}
 */
export async function searchTrends(q, limit = 20) {
  return request(`/v1/trends/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

/**
 * Map a KH category to a Trendscope category.
 * @param {string} khCategory
 * @returns {string}
 */
export function mapCategory(khCategory) {
  return CATEGORY_MAP[khCategory] || 'technology';
}

/**
 * Get anomaly detection results from Trendscope.
 * @param {number} [lookbackDays=14]
 * @returns {Promise<Array|null>}
 */
export async function getAnomalies(lookbackDays = 14) {
  return request(`/v1/anomalies?lookback_days=${lookbackDays}`);
}

/**
 * Get coverage analysis from Trendscope.
 * @returns {Promise<object|null>}
 */
export async function getCoverage() {
  return request('/v1/coverage');
}
