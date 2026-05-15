#!/bin/bash
# ─────────────────────────────────────────────────────
# release.sh — Release pipeline locale.
#
# Cosa fa (in ordine):
#   1. Pre-flight checks: branch, working tree pulito, tag non esistente
#   2. Verifica RELEASE_NOTES.md aggiornato (chiede conferma)
#   3. Build locale (audit:contracts + tsc + vite)
#   4. Bump versione in package.json + package-lock.json
#   5. Commit + tag + push (commit prima, poi tag) → workflow GA parte sul tag
#
# Uso:  ./scripts/release.sh 1.0.7
# ─────────────────────────────────────────────────────
set -euo pipefail

# ── Argomenti ──
VERSION="${1:?Uso: ./scripts/release.sh <versione>  (es. 1.0.7)}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo "❌ Versione non valida: '$VERSION' (atteso es. 1.0.7 oppure 1.0.7-test)"
    exit 1
fi
TAG="v${VERSION}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Colori ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

confirm() {
    local prompt="$1"
    read -r -p "$prompt [y/N] " resp
    case "$resp" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

echo -e "${GREEN}━━━ Pre-flight checks ━━━${NC}"

# 1. Branch corrente
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "  Branch corrente: ${CURRENT_BRANCH}"
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "test-release-workflow" && "$CURRENT_BRANCH" != "releases" ]]; then
    echo -e "  ${YELLOW}⚠  Sei su un branch insolito.${NC}"
    confirm "  Procedere comunque?" || exit 1
fi

# 2. Working tree pulito
if [[ -n "$(git status --porcelain)" ]]; then
    echo -e "  ${RED}❌ Working tree NON pulito.${NC} Committa o stasha le modifiche prima."
    git status --short
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Working tree pulito"

# 3. Tag non esistente (locale + remoto)
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo -e "  ${RED}❌ Il tag $TAG esiste già localmente.${NC}"
    echo "     Se vuoi rifare la release: git tag -d $TAG && git push origin :refs/tags/$TAG"
    exit 1
fi
if git ls-remote --tags origin "refs/tags/$TAG" | grep -q "$TAG"; then
    echo -e "  ${RED}❌ Il tag $TAG esiste già su remote.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Tag $TAG disponibile"

# 4. Allineato con remote
git fetch --quiet origin "$CURRENT_BRANCH" 2>/dev/null || true
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "@{u}" 2>/dev/null || echo "")
if [[ -n "$REMOTE" && "$LOCAL" != "$REMOTE" ]]; then
    BEHIND=$(git rev-list --count HEAD.."@{u}" 2>/dev/null || echo "0")
    AHEAD=$(git rev-list --count "@{u}"..HEAD 2>/dev/null || echo "0")
    if [[ "$BEHIND" -gt 0 ]]; then
        echo -e "  ${RED}❌ Sei $BEHIND commit indietro rispetto a origin/$CURRENT_BRANCH.${NC}"
        echo "     Esegui: git pull --rebase"
        exit 1
    fi
    echo -e "  ${YELLOW}⚠${NC}  Sei $AHEAD commit avanti rispetto a origin (verranno pushati)"
fi

# 5. RELEASE_NOTES.md
if [[ ! -f RELEASE_NOTES.md ]]; then
    echo -e "  ${RED}❌ RELEASE_NOTES.md non trovato.${NC}"
    exit 1
fi
NOTES_MTIME=$(stat -f %m RELEASE_NOTES.md 2>/dev/null || stat -c %Y RELEASE_NOTES.md)
PKG_MTIME=$(stat -f %m package.json 2>/dev/null || stat -c %Y package.json)
echo "  RELEASE_NOTES.md (modified $(date -r "$NOTES_MTIME" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$NOTES_MTIME" '+%Y-%m-%d %H:%M')):"
head -5 RELEASE_NOTES.md | sed 's/^/    │ /'
echo "    │ ..."
confirm "  È aggiornato per la versione $VERSION?" || {
    echo "  Aggiorna RELEASE_NOTES.md, committa e rilancia."
    exit 1
}

# ── Build locale ──
echo -e "\n${GREEN}━━━ Build locale (pre-flight) ━━━${NC}"
echo "  npm run build (audit:contracts + tsc + vite)..."
if ! npm run build > /tmp/release-build.log 2>&1; then
    echo -e "  ${RED}❌ Build fallita.${NC} Vedi /tmp/release-build.log"
    tail -30 /tmp/release-build.log
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Build ok"

# ── Bump versione ──
echo -e "\n${GREEN}━━━ Bump versione ━━━${NC}"
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "  $CURRENT_VERSION → $VERSION"
npm version "$VERSION" --no-git-tag-version >/dev/null
echo -e "  ${GREEN}✓${NC} package.json + package-lock.json aggiornati"

# ── Commit + tag + push ──
echo -e "\n${GREEN}━━━ Commit, tag, push ━━━${NC}"
git add package.json package-lock.json
git commit -m "release: ${TAG}"
git tag -a "$TAG" -m "Release ${TAG}"

echo "  Push commit + tag su origin/$CURRENT_BRANCH..."
git push -u origin HEAD
git push origin "$TAG"

echo -e "\n${GREEN}✅ Release ${TAG} pushata.${NC}"
echo ""
echo "  Workflow GitHub Actions ora gira:"
echo "    1. Build macOS (firma + notarizzazione)"
echo "    2. Build Windows"
echo "    3. Crea Release con DMG, ZIP, EXE, latest-mac.yml, latest.yml"
echo "    4. Aggiorna i link sul sito harmonytutor.it"
echo ""
echo "  Monitor: https://github.com/maomailzito-spec/harmony-tutor-releases/actions"
