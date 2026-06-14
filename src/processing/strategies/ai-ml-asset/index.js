// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * AI/ML Asset Strategy — Registers all processing strategies
 * for the ai_ml_asset artifact type.
 */

import { registerType } from '../../registry.js';
import { normalizeAiMlAsset } from './normalizer.js';
import { classifyAiMlAssets } from './classifier.js';
import { scoreAiMlAssets } from './scorer.js';

/**
 * Register all ai_ml_asset strategies in the registry.
 */
export function registerAiMlAssetStrategies() {
  registerType('ai_ml_asset', {
    normalize: normalizeAiMlAsset,
    classify: classifyAiMlAssets,
    score: scoreAiMlAssets,
  });
}

export { normalizeAiMlAsset, classifyAiMlAssets, scoreAiMlAssets };
