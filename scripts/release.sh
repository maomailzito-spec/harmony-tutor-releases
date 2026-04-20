#!/bin/bash
# ─────────────────────────────────────────────────────
# release.sh — Bumpa la versione, committa, tagga e pusha.
#              Il workflow GitHub Actions fa tutto il resto.
#
# Uso:  ./scripts/release.sh 1.0.2
# ─────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:?Uso: ./scripts/release.sh <versione>  (es. 1.0.2)}"
TAG="v${VERSION}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Aggiorna la versione in package.json (senza npm publish)
cd "$ROOT"
npm version "$VERSION" --no-git-tag-version

# 2. Commit + tag
git add package.json package-lock.json
git commit -m "release: ${TAG}"
git tag -a "$TAG" -m "Release ${TAG}"

# 3. Push commit + tag → il workflow parte automaticamente
git push -u origin HEAD && git push origin "$TAG"

echo ""
echo "✅  Tag ${TAG} pushato. Il workflow GitHub Actions ora:"
echo "    1. Builda macOS + Windows"
echo "    2. Crea la Release su GitHub"
echo "    3. Aggiorna i link sul sito"
echo ""
echo "Segui il progresso: https://github.com/maomailzito-spec/harmony-tutor-releases/actions"
