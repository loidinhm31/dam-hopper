#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
REPO="${2:-${GITHUB_REPOSITORY:-}}"

if [ -z "$TAG" ]; then
  echo "Error: Tag argument is required." >&2
  exit 1
fi

echo "Checking existing release status for ${TAG}..."
if REL_OUTPUT=$(gh release view "${TAG}" --json id,isDraft 2>&1); then
  REL_ID=$(echo "$REL_OUTPUT" | jq -r 'if .id != null then (.id | tostring) else "" end')
  IS_DRAFT=$(echo "$REL_OUTPUT" | jq -r 'if .isDraft != null then (.isDraft | tostring) else "" end')

  if [ "$IS_DRAFT" = "false" ]; then
    echo "Error: Release ${TAG} is already published (ID: ${REL_ID})! Refusing to overwrite or delete." >&2
    exit 1
  elif [ "$IS_DRAFT" = "true" ]; then
    if [ -z "$REL_ID" ]; then
      echo "Error: Draft release found for ${TAG} but failed to extract release ID." >&2
      exit 1
    fi
    echo "Cleaning up stale draft release for ${TAG} (ID: ${REL_ID})..."
    if [ -n "$REPO" ]; then
      gh api -X DELETE "repos/${REPO}/releases/${REL_ID}"
    else
      gh release delete "${TAG}" -y
    fi
  else
    echo "Error: Unexpected isDraft value '${IS_DRAFT}' for release ${TAG}." >&2
    exit 1
  fi
else
  # Inspect error output: only genuine "release not found" represents confirmed absence
  if echo "$REL_OUTPUT" | grep -qi "release not found"; then
    echo "Confirmed release ${TAG} does not exist yet. Proceeding."
  else
    echo "Error: Failed to inspect release status for ${TAG}: ${REL_OUTPUT}" >&2
    exit 1
  fi
fi
