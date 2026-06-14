// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
/**
 * Infrastructure Config Strategy — Registers all processing strategies
 * for the infra_config artifact type.
 */

import { registerType } from '../../registry.js';
import { normalizeInfraConfig } from './normalizer.js';
import { classifyInfraConfigs } from './classifier.js';
import { scoreInfraConfigs } from './scorer.js';

/**
 * Register all infra_config strategies in the registry.
 */
export function registerInfraConfigStrategies() {
  registerType('infra_config', {
    normalize: normalizeInfraConfig,
    classify: classifyInfraConfigs,
    score: scoreInfraConfigs,
  });
}

export { normalizeInfraConfig, classifyInfraConfigs, scoreInfraConfigs };
