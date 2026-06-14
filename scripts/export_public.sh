#!/usr/bin/env bash
# export_public.sh — Creates a clean public export of Knowledge Harvester for GozerAI/knowledge-harvester.
# Usage: bash scripts/export_public.sh [target_dir]
#
# Strips proprietary Pro/Enterprise modules and internal infrastructure,
# leaving only community-tier code + stub index.js files (so users see the upgrade path).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-${REPO_ROOT}/../knowledge-harvester-public-export}"

echo "=== Knowledge Harvester Public Export ==="
echo "Source: ${REPO_ROOT}"
echo "Target: ${TARGET}"

# Clean target
rm -rf "${TARGET}"
mkdir -p "${TARGET}"

# Use git archive to get a clean copy (respects .gitignore, excludes .git)
cd "${REPO_ROOT}"
git archive HEAD | tar -x -C "${TARGET}"

# ===== STRIP PROPRIETARY MODULES =====

# Pro tier — advanced data processing pipeline
rm -rf "${TARGET}/src/processing/"

# Pro tier — export functionality
rm -rf "${TARGET}/src/export/"

# Enterprise tier — third-party integrations (Trendscope, webhook, snapshot sync)
rm -rf "${TARGET}/src/integrations/"

# ===== STRIP TESTS FOR PROPRIETARY MODULES =====

# All processing tests
rm -rf "${TARGET}/tests/processing/"

# All export tests
rm -rf "${TARGET}/tests/export/"

# ===== STRIP INTERNAL REFERENCES =====

# Remove .env.example if it contains internal details
rm -f "${TARGET}/.env.example"

# Remove any internal CI/CD
rm -rf "${TARGET}/.github/"

# ===== CREATE STUB index.js FOR STRIPPED PACKAGES =====

# Pro: processing/
mkdir -p "${TARGET}/src/processing"
cat > "${TARGET}/src/processing/index.js" << 'JSEOF'
// This module requires a commercial license.
// Visit https://gozerai.com/pricing for Pro and Enterprise tier details.
throw new Error(
  `${__dirname.split('/').pop()} requires a commercial license. ` +
  'Visit https://gozerai.com/pricing for details.'
);
JSEOF

# Pro: export/
mkdir -p "${TARGET}/src/export"
cat > "${TARGET}/src/export/index.js" << 'JSEOF'
// This module requires a commercial license.
// Visit https://gozerai.com/pricing for Pro and Enterprise tier details.
throw new Error(
  `${__dirname.split('/').pop()} requires a commercial license. ` +
  'Visit https://gozerai.com/pricing for details.'
);
JSEOF

# Enterprise: integrations/
mkdir -p "${TARGET}/src/integrations"
cat > "${TARGET}/src/integrations/index.js" << 'JSEOF'
// This module requires a commercial license.
// Visit https://gozerai.com/pricing for Pro and Enterprise tier details.
throw new Error(
  `${__dirname.split('/').pop()} requires a commercial license. ` +
  'Visit https://gozerai.com/pricing for details.'
);
JSEOF

# ===== SANITIZE README =====
if [ -f "${TARGET}/README.md" ]; then
    sed -i 's|chrisarseno/knowledge-harvester|GozerAI/knowledge-harvester|g' "${TARGET}/README.md"
    sed -i 's|1450enterprises\.com|gozerai.com|g' "${TARGET}/README.md"
    sed -i 's|chrisarseno@[a-zA-Z.]*|dev@gozerai.com|g' "${TARGET}/README.md"
fi

# ===== UPDATE package.json =====
if [ -f "${TARGET}/package.json" ]; then
    sed -i 's|chrisarseno/knowledge-harvester|GozerAI/knowledge-harvester|g' "${TARGET}/package.json"
fi

echo ""
echo "=== Export complete: ${TARGET} ==="
echo ""
echo "Community-tier modules included:"
echo "  api/, config.js, db/, definitions/, harvesters/, index.js, server.js, utils/"
echo ""
echo "Stripped (Pro/Enterprise):"
echo "  processing/ (Pro), export/ (Pro), integrations/ (Enterprise)"
echo ""
echo "Next steps:"
echo "  cd ${TARGET}"
echo "  git init && git add -A && git commit -m 'Initial public release'"
echo "  gh repo create GozerAI/knowledge-harvester --public --description 'AI-powered knowledge collection and graph building — Part of the GozerAI ecosystem'"
echo "  git remote add origin https://github.com/GozerAI/knowledge-harvester.git"
echo "  git push -u origin main"
echo "  gh release create v1.0.0 --title 'v1.0.0' --notes 'Initial public release under GozerAI organization. Community-tier features included. Pro/Enterprise features require a commercial license — visit https://gozerai.com/pricing'"
echo "  gh repo edit chrisarseno/knowledge-harvester --visibility private"
