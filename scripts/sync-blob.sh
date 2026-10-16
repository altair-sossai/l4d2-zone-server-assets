#!/usr/bin/env bash
set -euo pipefail

usage="Usage: sync-blob.sh [--account <name>] --container <name> --source <dir> [--prefix <path>] [--cache-control <value>] [--dry-run]
Without --account, the storage comes from AZURE_STORAGE_CONNECTION_STRING."

account=""
container=""
source=""
prefix=""
cache_control=""
dry_run=false

while [ $# -gt 0 ]; do
  case "$1" in
    --account) account="$2"; shift 2 ;;
    --container) container="$2"; shift 2 ;;
    --source) source="$2"; shift 2 ;;
    --prefix) prefix="${2%/}"; shift 2 ;;
    --cache-control) cache_control="$2"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) echo "$usage" >&2; exit 1 ;;
  esac
done

if [ -z "$container" ] || [ -z "$source" ] || { [ -z "$account" ] && [ -z "${AZURE_STORAGE_CONNECTION_STRING:-}" ]; }; then
  echo "$usage" >&2
  exit 1
fi

storage=()
if [ -n "$account" ]; then
  storage=(--account-name "$account")
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

az storage blob list \
  "${storage[@]}" \
  --container-name "$container" \
  ${prefix:+--prefix "$prefix/"} \
  --num-results "*" \
  --only-show-errors \
  --query "[].[name, properties.contentSettings.contentMd5]" \
  -o tsv | tr -d '\r' | sort > "$work/remote"

(cd "$source" && find . -type f | sed 's|^\./||') | while IFS= read -r file; do
  md5=$(openssl md5 -binary "$source/$file" | base64)
  printf '%s\t%s\n' "${prefix:+$prefix/}$file" "$md5"
done | sort > "$work/local"

comm -23 "$work/local" "$work/remote" | cut -f1 > "$work/changed"
total=$(wc -l < "$work/local" | tr -d ' ')
changed=$(wc -l < "$work/changed" | tr -d ' ')
echo "$container/${prefix:+$prefix/}: $changed of $total files changed"

if [ "$changed" -eq 0 ]; then
  exit 0
fi

if [ "$dry_run" = true ]; then
  cat "$work/changed"
  exit 0
fi

mkdir -p "$work/staging"
while IFS= read -r name; do
  file="${name#"${prefix:+$prefix/}"}"
  mkdir -p "$work/staging/$(dirname "$file")"
  cp "$source/$file" "$work/staging/$file"
done < "$work/changed"

uploaded=0

upload() {
  local pattern="$1"
  local content_type="$2"
  local count
  count=$(find "$work/staging" -type f -name "$pattern" | wc -l | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    return
  fi

  az storage blob upload-batch \
    "${storage[@]}" \
    --destination "$container" \
    ${prefix:+--destination-path "$prefix"} \
    --source "$work/staging" \
    --pattern "$pattern" \
    --overwrite \
    --only-show-errors \
    ${content_type:+--content-type "$content_type"} \
    ${cache_control:+--content-cache-control "$cache_control"} > /dev/null
  find "$work/staging" -type f -name "$pattern" -delete
  uploaded=$((uploaded + count))
}

upload "*.avif" "image/avif"
upload "*.webp" "image/webp"
upload "*" ""

echo "$container/${prefix:+$prefix/}: uploaded $uploaded files"
if [ "$uploaded" -ne "$changed" ]; then
  echo "Expected to upload $changed files" >&2
  exit 1
fi
