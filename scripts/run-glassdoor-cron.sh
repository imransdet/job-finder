#!/usr/bin/env bash
# Glassdoor daily cron runner.
# Loads .env from the project root and runs the Glassdoor Playwright test.
# Cron runs with a minimal environment, so we set PATH and load secrets explicitly.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/glassdoor-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

echo "=== Glassdoor cron run: $(date) ===" >> "$LOG_FILE"

# Add Homebrew node to PATH (not available in cron's minimal environment)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Load .env (skip comment lines and blank lines)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  source <(grep -v '^\s*#' "$PROJECT_DIR/.env" | grep -v '^\s*$')
  set +o allexport
fi

cd "$PROJECT_DIR"

HEADLESS=true npx playwright test glassdoor-jobs >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

echo "=== Finished: $(date) — exit $EXIT_CODE ===" >> "$LOG_FILE"

# Keep only the last 14 log files
ls -t "$LOG_DIR"/glassdoor-*.log 2>/dev/null | tail -n +15 | xargs rm -f || true

exit $EXIT_CODE
