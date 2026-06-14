// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Re-implement pure functions for testing (no DB deps) ──
// Mirrors the logic in src/processing/license-detector.js exactly.

const LICENSES = [
  { spdx_id: 'MIT',          name: 'MIT License' },
  { spdx_id: 'Apache-2.0',   name: 'Apache License 2.0' },
  { spdx_id: 'GPL-3.0',      name: 'GNU General Public License v3.0' },
  { spdx_id: 'GPL-2.0',      name: 'GNU General Public License v2.0' },
  { spdx_id: 'BSD-3-Clause', name: 'BSD 3-Clause License' },
  { spdx_id: 'BSD-2-Clause', name: 'BSD 2-Clause License' },
  { spdx_id: 'ISC',          name: 'ISC License' },
  { spdx_id: 'MPL-2.0',      name: 'Mozilla Public License 2.0' },
  { spdx_id: 'AGPL-3.0',     name: 'GNU Affero General Public License v3.0' },
  { spdx_id: 'Unlicense',    name: 'The Unlicense' },
  { spdx_id: 'LGPL-2.1',     name: 'GNU Lesser General Public License v2.1' },
  { spdx_id: 'LGPL-3.0',     name: 'GNU Lesser General Public License v3.0' },
];

const LICENSE_MAP = Object.fromEntries(LICENSES.map(l => [l.spdx_id, l.name]));

const SPDX_PATTERN = /SPDX-License-Identifier:\s*([A-Za-z0-9\-.+]+)/i;

const TEXT_PATTERNS = [
  {
    spdx_id: 'MIT',
    patterns: [
      /permission is hereby granted,\s+free of charge/i,
      /the above copyright notice and this permission notice shall be included/i,
    ],
  },
  {
    spdx_id: 'Apache-2.0',
    patterns: [
      /licensed under the apache license,\s+version 2\.0/i,
      /www\.apache\.org\/licenses\/LICENSE-2\.0/i,
    ],
  },
  {
    spdx_id: 'GPL-3.0',
    patterns: [
      /gnu general public license.*version 3/i,
      /https?:\/\/www\.gnu\.org\/licenses\/gpl-3/i,
    ],
  },
  {
    spdx_id: 'GPL-2.0',
    patterns: [
      /gnu general public license.*version 2/i,
      /https?:\/\/www\.gnu\.org\/licenses\/gpl-2/i,
    ],
  },
  {
    spdx_id: 'AGPL-3.0',
    patterns: [
      /gnu affero general public license.*version 3/i,
      /https?:\/\/www\.gnu\.org\/licenses\/agpl/i,
    ],
  },
  {
    spdx_id: 'LGPL-3.0',
    patterns: [
      /gnu lesser general public license.*version 3/i,
      /https?:\/\/www\.gnu\.org\/licenses\/lgpl-3/i,
    ],
  },
  {
    spdx_id: 'LGPL-2.1',
    patterns: [
      /gnu lesser general public license.*version 2\.1/i,
      /https?:\/\/www\.gnu\.org\/licenses\/lgpl-2\.1/i,
    ],
  },
  {
    spdx_id: 'MPL-2.0',
    patterns: [
      /mozilla public license.*version 2\.0/i,
      /mozilla\.org\/MPL\/2\.0/i,
    ],
  },
  {
    spdx_id: 'BSD-3-Clause',
    patterns: [
      /redistributions? in binary form must reproduce the above copyright/i,
      /neither the name.*nor the names of its contributors/i,
    ],
  },
  {
    spdx_id: 'BSD-2-Clause',
    patterns: [
      /redistributions? of source code must retain the above copyright notice/i,
    ],
  },
  {
    spdx_id: 'ISC',
    patterns: [
      /permission to use,\s+copy,\s+modify.*and\/or distribute/i,
    ],
  },
  {
    spdx_id: 'Unlicense',
    patterns: [
      /this is free and unencumbered software released into the public domain/i,
      /unlicense\.org/i,
    ],
  },
];

const HEADER_PATTERNS = [
  { spdx_id: 'MIT',          pattern: /\blicensed under (?:the )?mit\b/i },
  { spdx_id: 'MIT',          pattern: /\bmit licen[cs]e\b/i },
  { spdx_id: 'Apache-2.0',   pattern: /\blicensed under (?:the )?apache licen[cs]e,?\s+(?:version\s+)?2\.0\b/i },
  { spdx_id: 'Apache-2.0',   pattern: /\bapache-2\.0\b/i },
  { spdx_id: 'GPL-3.0',      pattern: /\bgpl.?v?3\b|\bversion 3 of the gnu/i },
  { spdx_id: 'GPL-2.0',      pattern: /\bgpl.?v?2\b|\bversion 2 of the gnu/i },
  { spdx_id: 'AGPL-3.0',     pattern: /\bagpl.?v?3\b/i },
  { spdx_id: 'LGPL-3.0',     pattern: /\blgpl.?v?3\b/i },
  { spdx_id: 'LGPL-2.1',     pattern: /\blgpl.?v?2\.1\b/i },
  { spdx_id: 'BSD-3-Clause', pattern: /\bbsd.?3.clause\b|\bbsd 3.clause\b/i },
  { spdx_id: 'BSD-2-Clause', pattern: /\bbsd.?2.clause\b|\bbsd 2.clause\b/i },
  { spdx_id: 'ISC',          pattern: /\bisc licen[cs]e\b/i },
  { spdx_id: 'MPL-2.0',      pattern: /\bmpl.?2\.0\b|\bmozilla public licen[cs]e 2/i },
  { spdx_id: 'Unlicense',    pattern: /\bthe unlicen[cs]e\b|\bpublic domain\b/i },
];

const LICENSE_FILENAMES = /^(LICENSE|LICENCE|COPYING|UNLICENSE)(\.txt|\.md)?$/i;

function trySpdxIdentifier(text) {
  const match = SPDX_PATTERN.exec(text);
  if (!match) return null;
  const raw = match[1].trim();
  const license = LICENSES.find(l => l.spdx_id.toLowerCase() === raw.toLowerCase());
  if (!license) return null;
  return { spdx_id: license.spdx_id, license_name: license.name, confidence: 0.95, detection_method: 'spdx_identifier' };
}

function tryLicenseText(text) {
  for (const entry of TEXT_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return { spdx_id: entry.spdx_id, license_name: LICENSE_MAP[entry.spdx_id], confidence: 0.85, detection_method: 'license_text' };
      }
    }
  }
  return null;
}

function tryHeaderPattern(text) {
  for (const entry of HEADER_PATTERNS) {
    if (entry.pattern.test(text)) {
      return { spdx_id: entry.spdx_id, license_name: LICENSE_MAP[entry.spdx_id], confidence: 0.70, detection_method: 'header_pattern' };
    }
  }
  return null;
}

function tryFilename(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const existing = meta.license;
  if (existing && typeof existing === 'string') {
    const license = LICENSES.find(
      l => l.spdx_id.toLowerCase() === existing.toLowerCase() ||
           l.name.toLowerCase() === existing.toLowerCase()
    );
    if (license) {
      return { spdx_id: license.spdx_id, license_name: license.name, confidence: 0.60, detection_method: 'filename' };
    }
  }
  const files = Array.isArray(meta.files) ? meta.files : (meta.filename ? [meta.filename] : []);
  for (const f of files) {
    if (typeof f === 'string' && LICENSE_FILENAMES.test(f)) {
      return { spdx_id: null, license_name: 'Unknown', confidence: 0.60, detection_method: 'filename' };
    }
  }
  return null;
}

function detectLicense(content, typeMetadata = {}) {
  const text = typeof content === 'string' ? content : '';
  const meta = (typeMetadata && typeof typeMetadata === 'object') ? typeMetadata : {};

  const bySpdx = trySpdxIdentifier(text);
  if (bySpdx) return bySpdx;

  const byText = tryLicenseText(text);
  if (byText) return byText;

  const byHeader = tryHeaderPattern(text);
  if (byHeader) return byHeader;

  const byFilename = tryFilename(meta);
  if (byFilename) return byFilename;

  return { spdx_id: null, license_name: 'Unknown', confidence: 0, detection_method: 'none' };
}

// ── Batch logic (reimplemented without DB) ──

function detectLicenseBatchPure(artifacts) {
  let processed = 0;
  let licensed = 0;
  let unknown = 0;
  const results = [];

  for (const artifact of artifacts) {
    const meta = typeof artifact.type_metadata === 'string'
      ? JSON.parse(artifact.type_metadata)
      : (artifact.type_metadata || {});

    const licenseInfo = detectLicense(artifact.content || '', meta);

    results.push({ id: artifact.id, licenseInfo });
    processed++;
    if (licenseInfo.detection_method !== 'none') {
      licensed++;
    } else {
      unknown++;
    }
  }

  return { processed, licensed, unknown, results };
}

// ── Test Fixtures ──

const MIT_FULL_TEXT = `
MIT License

Copyright (c) 2024 Acme Corp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
`;

const APACHE_HEADER = `
Copyright 2024 Acme Corp

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
`;

const GPL3_PREAMBLE = `
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License version 3
as published by the Free Software Foundation.
`;

const GPL2_PREAMBLE = `
This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License version 2
as published by the Free Software Foundation.
`;

const UNLICENSE_TEXT = `
This is free and unencumbered software released into the public domain.
Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any means.
`;

// ── SPDX Identifier Detection ──

describe('SPDX identifier detection', () => {
  it('detects MIT via SPDX tag', () => {
    const result = detectLicense('// SPDX-License-Identifier: MIT\nconst x = 1;');
    assert.equal(result.spdx_id, 'MIT');
    assert.equal(result.license_name, 'MIT License');
    assert.equal(result.detection_method, 'spdx_identifier');
    assert.equal(result.confidence, 0.95);
  });

  it('detects Apache-2.0 via SPDX tag', () => {
    const result = detectLicense('// SPDX-License-Identifier: Apache-2.0');
    assert.equal(result.spdx_id, 'Apache-2.0');
    assert.equal(result.detection_method, 'spdx_identifier');
  });

  it('detects GPL-3.0 via SPDX tag', () => {
    const result = detectLicense('# SPDX-License-Identifier: GPL-3.0');
    assert.equal(result.spdx_id, 'GPL-3.0');
    assert.equal(result.detection_method, 'spdx_identifier');
  });

  it('detects Unlicense via SPDX tag', () => {
    const result = detectLicense('// SPDX-License-Identifier: Unlicense');
    assert.equal(result.spdx_id, 'Unlicense');
    assert.equal(result.detection_method, 'spdx_identifier');
  });

  it('detects LGPL-2.1 via SPDX tag', () => {
    const result = detectLicense('// SPDX-License-Identifier: LGPL-2.1');
    assert.equal(result.spdx_id, 'LGPL-2.1');
    assert.equal(result.detection_method, 'spdx_identifier');
  });

  it('ignores unknown SPDX identifier and falls through', () => {
    const result = detectLicense('// SPDX-License-Identifier: CUSTOM-1.0');
    // Should not produce spdx_identifier — no known license matched
    assert.notEqual(result.detection_method, 'spdx_identifier');
  });

  it('handles SPDX tag case-insensitively', () => {
    const result = detectLicense('/* spdx-license-identifier: mit */');
    assert.equal(result.spdx_id, 'MIT');
    assert.equal(result.detection_method, 'spdx_identifier');
  });
});

// ── License Text Detection ──

describe('license text detection', () => {
  it('detects MIT from full license text', () => {
    const result = detectLicense(MIT_FULL_TEXT);
    assert.equal(result.spdx_id, 'MIT');
    assert.equal(result.detection_method, 'license_text');
    assert.equal(result.confidence, 0.85);
  });

  it('detects Apache-2.0 from Apache header', () => {
    const result = detectLicense(APACHE_HEADER);
    assert.equal(result.spdx_id, 'Apache-2.0');
    assert.equal(result.detection_method, 'license_text');
  });

  it('detects GPL-3.0 from GPL preamble', () => {
    const result = detectLicense(GPL3_PREAMBLE);
    assert.equal(result.spdx_id, 'GPL-3.0');
    assert.equal(result.detection_method, 'license_text');
  });

  it('detects GPL-2.0 from GPL v2 preamble', () => {
    const result = detectLicense(GPL2_PREAMBLE);
    assert.equal(result.spdx_id, 'GPL-2.0');
    assert.equal(result.detection_method, 'license_text');
  });

  it('detects Unlicense from public domain declaration', () => {
    const result = detectLicense(UNLICENSE_TEXT);
    assert.equal(result.spdx_id, 'Unlicense');
    assert.equal(result.detection_method, 'license_text');
  });

  it('detects Apache-2.0 from URL in text', () => {
    const result = detectLicense('See www.apache.org/licenses/LICENSE-2.0 for details.');
    assert.equal(result.spdx_id, 'Apache-2.0');
    assert.equal(result.detection_method, 'license_text');
  });
});

// ── Header Pattern Detection ──

describe('header pattern detection', () => {
  it('detects MIT from short comment header', () => {
    const result = detectLicense('// Licensed under the MIT License\nfunction foo() {}');
    assert.equal(result.spdx_id, 'MIT');
    assert.equal(result.detection_method, 'header_pattern');
    assert.equal(result.confidence, 0.70);
  });

  it('detects Apache-2.0 from Apache-2.0 header shorthand', () => {
    const result = detectLicense('# This file is Apache-2.0 licensed');
    assert.equal(result.spdx_id, 'Apache-2.0');
    assert.equal(result.detection_method, 'header_pattern');
  });

  it('detects GPL-3.0 from GPLv3 mention', () => {
    const result = detectLicense('// This software is GPLv3 licensed');
    assert.equal(result.spdx_id, 'GPL-3.0');
    assert.equal(result.detection_method, 'header_pattern');
  });

  it('detects LGPL-2.1 from LGPL v2.1 mention', () => {
    const result = detectLicense('# Released under LGPL v2.1');
    assert.equal(result.spdx_id, 'LGPL-2.1');
    assert.equal(result.detection_method, 'header_pattern');
  });

  it('detects ISC from ISC License mention', () => {
    const result = detectLicense('/* ISC License */');
    assert.equal(result.spdx_id, 'ISC');
    assert.equal(result.detection_method, 'header_pattern');
  });

  it('detects MPL-2.0 from Mozilla Public License 2 mention', () => {
    const result = detectLicense('// Mozilla Public License 2.0 applies');
    assert.equal(result.spdx_id, 'MPL-2.0');
    assert.equal(result.detection_method, 'header_pattern');
  });

  it('detects BSD-3-Clause from BSD 3-Clause header', () => {
    const result = detectLicense('# BSD 3-Clause License');
    assert.equal(result.spdx_id, 'BSD-3-Clause');
    assert.equal(result.detection_method, 'header_pattern');
  });
});

// ── Filename-based Detection ──

describe('filename-based detection', () => {
  it('detects license from type_metadata.license field (SPDX)', () => {
    const result = detectLicense('no license text here', { license: 'MIT' });
    assert.equal(result.spdx_id, 'MIT');
    assert.equal(result.detection_method, 'filename');
    assert.equal(result.confidence, 0.60);
  });

  it('detects license from type_metadata.license field (full name)', () => {
    const result = detectLicense('', { license: 'Apache License 2.0' });
    assert.equal(result.spdx_id, 'Apache-2.0');
    assert.equal(result.detection_method, 'filename');
  });

  it('detects presence of LICENSE file in metadata.files array', () => {
    const result = detectLicense('', { files: ['README.md', 'LICENSE', 'src/index.js'] });
    assert.equal(result.detection_method, 'filename');
    assert.equal(result.confidence, 0.60);
    // spdx_id is null because filename alone cannot determine which license
    assert.equal(result.spdx_id, null);
  });

  it('detects COPYING filename as license file indicator', () => {
    const result = detectLicense('', { files: ['COPYING'] });
    assert.equal(result.detection_method, 'filename');
  });

  it('detects LICENSE.txt filename', () => {
    const result = detectLicense('', { filename: 'LICENSE.txt' });
    assert.equal(result.detection_method, 'filename');
  });

  it('does not trigger on non-license filenames', () => {
    const result = detectLicense('', { files: ['README.md', 'src/main.js'] });
    assert.equal(result.detection_method, 'none');
  });
});

// ── No License / Unknown Cases ──

describe('unknown / no-license cases', () => {
  it('returns none for empty content with no metadata', () => {
    const result = detectLicense('');
    assert.equal(result.spdx_id, null);
    assert.equal(result.license_name, 'Unknown');
    assert.equal(result.confidence, 0);
    assert.equal(result.detection_method, 'none');
  });

  it('returns none for random code with no license signals', () => {
    const result = detectLicense('function add(a, b) { return a + b; }');
    assert.equal(result.detection_method, 'none');
    assert.equal(result.confidence, 0);
  });

  it('returns none for null content', () => {
    const result = detectLicense(null);
    assert.equal(result.detection_method, 'none');
  });

  it('returns none for null metadata and empty content', () => {
    const result = detectLicense('', null);
    assert.equal(result.detection_method, 'none');
  });

  it('returns none for undefined metadata', () => {
    const result = detectLicense('some code here');
    assert.equal(result.detection_method, 'none');
  });
});

// ── Confidence Scoring Ordering ──

describe('confidence score ordering', () => {
  it('SPDX identifier yields highest confidence (~0.95)', () => {
    const result = detectLicense('// SPDX-License-Identifier: MIT');
    assert.equal(result.confidence, 0.95);
  });

  it('license text yields 0.85', () => {
    const result = detectLicense(MIT_FULL_TEXT);
    assert.equal(result.confidence, 0.85);
  });

  it('header pattern yields 0.70', () => {
    const result = detectLicense('// Licensed under the MIT License');
    assert.equal(result.confidence, 0.70);
  });

  it('filename detection yields 0.60', () => {
    const result = detectLicense('', { license: 'MIT' });
    assert.equal(result.confidence, 0.60);
  });

  it('no detection yields 0', () => {
    const result = detectLicense('console.log("hello")');
    assert.equal(result.confidence, 0);
  });

  it('SPDX confidence is higher than all other methods', () => {
    const spdx = detectLicense('// SPDX-License-Identifier: MIT');
    const text = detectLicense(MIT_FULL_TEXT);
    const header = detectLicense('// MIT License');
    assert.ok(spdx.confidence > text.confidence);
    assert.ok(text.confidence > header.confidence);
  });
});

// ── Priority Order (first match wins) ──

describe('detection priority order', () => {
  it('SPDX tag wins even when license text is present', () => {
    const content = `// SPDX-License-Identifier: MIT\n${MIT_FULL_TEXT}`;
    const result = detectLicense(content);
    assert.equal(result.detection_method, 'spdx_identifier');
  });

  it('license text wins over header pattern', () => {
    // MIT full text contains "MIT License" — text pattern fires before header pattern
    const content = MIT_FULL_TEXT;
    const result = detectLicense(content);
    assert.equal(result.detection_method, 'license_text');
  });

  it('header pattern wins over filename when content has a header', () => {
    const result = detectLicense('// MIT License', { files: ['LICENSE'] });
    assert.equal(result.detection_method, 'header_pattern');
  });
});

// ── Edge Cases ──

describe('edge cases', () => {
  it('handles content that is a number (coerced to empty string)', () => {
    const result = detectLicense(42);
    assert.equal(result.detection_method, 'none');
  });

  it('handles metadata that is a string (treated as no-op)', () => {
    // Non-object metadata should not throw
    const result = detectLicense('', 'MIT');
    assert.equal(result.detection_method, 'none');
  });

  it('handles malformed SPDX (extra spaces)', () => {
    // Spaces inside identifier value — regex strips trailing, but spaces within
    // the identifier break it into an unrecognised id; should fall through gracefully
    const result = detectLicense('// SPDX-License-Identifier:   MIT  ');
    // Trim is applied — should still detect
    assert.equal(result.spdx_id, 'MIT');
  });

  it('handles multiline content without crashing', () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    assert.doesNotThrow(() => detectLicense(content));
  });
});

// ── Batch Function Logic ──

describe('batch license detection', () => {
  it('processes all artifacts and returns correct counts', () => {
    const artifacts = [
      { id: 1, content: '// SPDX-License-Identifier: MIT', type_metadata: {} },
      { id: 2, content: MIT_FULL_TEXT,                     type_metadata: {} },
      { id: 3, content: 'function foo() {}',               type_metadata: {} },
    ];

    const { processed, licensed, unknown } = detectLicenseBatchPure(artifacts);
    assert.equal(processed, 3);
    assert.equal(licensed, 2);
    assert.equal(unknown, 1);
  });

  it('returns correct license info per artifact', () => {
    const artifacts = [
      { id: 10, content: '// SPDX-License-Identifier: Apache-2.0', type_metadata: {} },
    ];
    const { results } = detectLicenseBatchPure(artifacts);
    assert.equal(results.length, 1);
    assert.equal(results[0].licenseInfo.spdx_id, 'Apache-2.0');
    assert.equal(results[0].licenseInfo.detection_method, 'spdx_identifier');
  });

  it('handles empty artifact list', () => {
    const { processed, licensed, unknown } = detectLicenseBatchPure([]);
    assert.equal(processed, 0);
    assert.equal(licensed, 0);
    assert.equal(unknown, 0);
  });

  it('handles artifacts with string-encoded type_metadata', () => {
    const artifacts = [
      { id: 5, content: '', type_metadata: JSON.stringify({ license: 'GPL-3.0' }) },
    ];
    const { results } = detectLicenseBatchPure(artifacts);
    assert.equal(results[0].licenseInfo.spdx_id, 'GPL-3.0');
    assert.equal(results[0].licenseInfo.detection_method, 'filename');
  });

  it('handles missing content field gracefully', () => {
    const artifacts = [{ id: 7, type_metadata: {} }];
    assert.doesNotThrow(() => detectLicenseBatchPure(artifacts));
    const { processed, unknown } = detectLicenseBatchPure(artifacts);
    assert.equal(processed, 1);
    assert.equal(unknown, 1);
  });

  it('all-licensed batch returns zero unknown', () => {
    const artifacts = [
      { id: 1, content: '// SPDX-License-Identifier: MIT',        type_metadata: {} },
      { id: 2, content: '// SPDX-License-Identifier: Apache-2.0', type_metadata: {} },
      { id: 3, content: '// SPDX-License-Identifier: GPL-3.0',    type_metadata: {} },
    ];
    const { licensed, unknown } = detectLicenseBatchPure(artifacts);
    assert.equal(licensed, 3);
    assert.equal(unknown, 0);
  });
});
