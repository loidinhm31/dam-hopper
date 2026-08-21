#!/usr/bin/env bash
set -Eeuo pipefail

readonly JOURNAL_TOKEN_PATH="${PHASE03_JOURNAL_TOKEN_PATH:-/home/loidinh/.config/dam-hopper/server-token}"
journal_tmp="$(mktemp)"
trap 'rm -f -- "$journal_tmp"' EXIT

sudo -v

journal_read=0
if sudo journalctl -u dam-hopper.service --no-pager -n 200 >"$journal_tmp"; then
  journal_read=1
fi

journal_dispose=0
if [ "$journal_read" -eq 1 ] &&
  rg -q -F 'Disposing all PTY sessions' "$journal_tmp"; then
  journal_dispose=1
fi

journal_shutdown=0
if [ "$journal_read" -eq 1 ] &&
  rg -q -F 'Server shutdown complete' "$journal_tmp"; then
  journal_shutdown=1
fi

journal_secret_scan=0
journal_text="$(<"$journal_tmp")"
if [ -r "$JOURNAL_TOKEN_PATH" ]; then
  journal_token="$(<"$JOURNAL_TOKEN_PATH")"
  if [ -n "$journal_token" ]; then
    journal_secret_scan=1
    if [[ "$journal_text" == *"$journal_token"* ]]; then
      journal_secret_scan=0
    fi
  fi
  unset journal_token
fi
if [ "$journal_secret_scan" -eq 1 ]; then
  journal_scan_status=0
  if rg -q -i \
    -e 'mongodb(\+srv)?://' \
    -e 'Authorization:[[:space:]]*Bearer' \
    -e 'Bearer[[:space:]]+[A-Za-z0-9._-]{20,}' \
    "$journal_tmp"; then
    journal_secret_scan=0
  else
    journal_scan_status=$?
    if [ "$journal_scan_status" -ne 1 ]; then
      journal_secret_scan=0
    fi
  fi
fi
unset journal_text

printf 'journal_read=%s\n' "$journal_read"
printf 'journal_dispose=%s\n' "$journal_dispose"
printf 'journal_shutdown=%s\n' "$journal_shutdown"
printf 'journal_secret_scan=%s\n' "$journal_secret_scan"

if [ "$journal_read" -eq 1 ] &&
  [ "$journal_dispose" -eq 1 ] &&
  [ "$journal_shutdown" -eq 1 ] &&
  [ "$journal_secret_scan" -eq 1 ]; then
  exit 0
fi
exit 1
