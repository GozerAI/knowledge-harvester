// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Code Pattern Strategy — Registers all processing strategies
 * for the code_pattern artifact type.
 */

import { registerType } from '../../registry.js';
import { normalizeCodePattern } from './normalizer.js';
import { classifyCodePatterns } from './classifier.js';
import { scoreCodePatterns } from './scorer.js';

/**
 * Register all code_pattern strategies in the registry.
 */
export function registerCodePatternStrategies() {
  registerType('code_pattern', {
    normalize: normalizeCodePattern,
    classify: classifyCodePatterns,
    score: scoreCodePatterns,
  });
}

export { normalizeCodePattern, classifyCodePatterns, scoreCodePatterns };
