// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * API Spec Strategy — Registers all processing strategies
 * for the api_spec artifact type.
 */

import { registerType } from '../../registry.js';
import { normalizeApiSpec } from './normalizer.js';
import { classifyApiSpecs } from './classifier.js';
import { scoreApiSpecs } from './scorer.js';

export function registerApiSpecStrategies() {
  registerType('api_spec', {
    normalize: normalizeApiSpec,
    classify: classifyApiSpecs,
    score: scoreApiSpecs,
  });
}

export { normalizeApiSpec, classifyApiSpecs, scoreApiSpecs };
