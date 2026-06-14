// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Documentation Strategy — Registers all processing strategies
 * for the documentation artifact type.
 */

import { registerType } from '../../registry.js';
import { normalizeDocumentation } from './normalizer.js';
import { classifyDocumentation } from './classifier.js';
import { scoreDocumentation } from './scorer.js';

export function registerDocumentationStrategies() {
  registerType('documentation', {
    normalize: normalizeDocumentation,
    classify: classifyDocumentation,
    score: scoreDocumentation,
  });
}

export { normalizeDocumentation, classifyDocumentation, scoreDocumentation };
