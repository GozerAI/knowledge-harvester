// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Data Asset Strategy — Registers all processing strategies
 * for the data_asset artifact type.
 */

import { registerType } from '../../registry.js';
import { normalizeDataAsset } from './normalizer.js';
import { classifyDataAssets } from './classifier.js';
import { scoreDataAssets } from './scorer.js';

export function registerDataAssetStrategies() {
  registerType('data_asset', {
    normalize: normalizeDataAsset,
    classify: classifyDataAssets,
    score: scoreDataAssets,
  });
}

export { normalizeDataAsset, classifyDataAssets, scoreDataAssets };
