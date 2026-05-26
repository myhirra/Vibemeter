#!/usr/bin/env bash
# vibemeter-notify — speak + display a macOS notification when Claude Code /
# Codex finishes. Driven by env vars so Vibemeter's settings page can rewrite
# the hook command without redeploying this script.
#
# Usage: vibemeter-notify <tool> <status>
#   tool   — "Claude", "Codex", ... (shown in the title + spoken)
#   status — complete | needs_input | failed | <anything else>

set -euo pipefail

TOOL="${1:-AI}"
STATUS="${2:-complete}"
LOCALE="${VIBEMETER_NOTIFY_LOCALE:-zh}"

# Honor pause flag set by the floater's "Pause 30m" button.
PAUSE_FILE="${VIBEMETER_DATA_DIR:-$HOME/.vibemeter}/pause-until"
if [[ -f "$PAUSE_FILE" ]]; then
  until_ms="$(cat "$PAUSE_FILE" 2>/dev/null || true)"
  if [[ "$until_ms" =~ ^[0-9]+$ ]]; then
    now_ms=$(($(date +%s) * 1000))
    if (( now_ms < until_ms )); then exit 0; fi
  fi
fi
PROJECT="${VIBEMETER_NOTIFY_PROJECT:-$(basename "${PWD:-unknown}")}"
LOCK_DIR="${VIBEMETER_NOTIFY_LOCK_DIR:-${TMPDIR:-/tmp}/vibemeter-notify.lock}"
STATE_FILE="${VIBEMETER_NOTIFY_STATE_FILE:-${TMPDIR:-/tmp}/vibemeter-notify.last}"
DEDUPE_SECONDS="${VIBEMETER_NOTIFY_DEDUPE_SECONDS:-4}"

# Voice default depends on locale: Chinese voice for zh, system default for en
# (English say without -v uses the user's system voice, usually Alex / Samantha).
if [[ -n "${VIBEMETER_NOTIFY_VOICE:-}" ]]; then
  VOICE="$VIBEMETER_NOTIFY_VOICE"
elif [[ "$LOCALE" == "en" ]]; then
  VOICE=""  # empty means: let `say` pick the system default
else
  VOICE="Tingting"
fi

if [[ "$LOCALE" == "en" ]]; then
  case "$STATUS" in
    complete|done|success)
      TITLE="$TOOL done"
      BODY="$PROJECT finished"
      SAY_SUFFIX="done"
      ;;
    needs_input|input|intervention|permission)
      TITLE="$TOOL needs you"
      BODY="$PROJECT needs your attention"
      SAY_SUFFIX="needs you"
      ;;
    failed|fail|error)
      TITLE="$TOOL may have failed"
      BODY="$PROJECT may have failed"
      SAY_SUFFIX="may have failed"
      ;;
    *)
      TITLE="$TOOL notice"
      BODY="$PROJECT $STATUS"
      SAY_SUFFIX="$STATUS"
      ;;
  esac
  SAY_TEXT="$TOOL [[slnc 80]]$PROJECT[[slnc 80]] $SAY_SUFFIX"
else
  case "$STATUS" in
    complete|done|success)
      TITLE="$TOOL 完成"
      BODY="$PROJECT 已完成"
      SAY_SUFFIX="完成"
      ;;
    needs_input|input|intervention|permission)
      TITLE="$TOOL 需要介入"
      BODY="$PROJECT 需要你看一下"
      SAY_SUFFIX="需要你看一下"
      ;;
    failed|fail|error)
      TITLE="$TOOL 可能失败"
      BODY="$PROJECT 可能失败了"
      SAY_SUFFIX="可能失败"
      ;;
    *)
      TITLE="$TOOL 通知"
      BODY="$PROJECT $STATUS"
      SAY_SUFFIX="$STATUS"
      ;;
  esac
  SAY_TEXT="$TOOL [[slnc 80]]$PROJECT[[slnc 80]] $SAY_SUFFIX"
fi
KEY="$TOOL|$PROJECT|$STATUS"
LOCK_HELD=0

release_lock() {
  if [[ "$LOCK_HELD" == "1" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

acquire_lock() {
  local i
  for i in {1..150}; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      LOCK_HELD=1
      trap release_lock EXIT
      return 0
    fi
    sleep 0.1
  done
  return 1
}

escape_osascript_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

should_skip_duplicate() {
  local now last_ts last_key
  now="$(date +%s)"
  if [[ -f "$STATE_FILE" ]]; then
    IFS=$'\t' read -r last_ts last_key < "$STATE_FILE" || true
    if [[ "${last_key:-}" == "$KEY" && "${last_ts:-0}" =~ ^[0-9]+$ ]]; then
      if (( now - last_ts < DEDUPE_SECONDS )); then
        return 0
      fi
    fi
  fi
  mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true
  printf '%s\t%s\n' "$now" "$KEY" > "$STATE_FILE"
  return 1
}

emit_dry_run() {
  printf 'TITLE=%s\n' "$TITLE"
  printf 'SUBTITLE=%s\n' "$PROJECT"
  printf 'BODY=%s\n' "$BODY"
  printf 'SAY=%s\n' "$SAY_TEXT"
  printf 'SOUND_MODE=%s\n' "${VIBEMETER_NOTIFY_SOUND_MODE:-voice}"
}

main() {
  acquire_lock || true

  if should_skip_duplicate; then
    if [[ "${VIBEMETER_NOTIFY_DRY_RUN:-0}" == "1" ]]; then
      printf 'SKIPPED=duplicate\n'
    fi
    return 0
  fi

  if [[ "${VIBEMETER_NOTIFY_DRY_RUN:-0}" == "1" ]]; then
    emit_dry_run
    return 0
  fi

  local title subtitle body
  title="$(escape_osascript_string "$TITLE")"
  subtitle="$(escape_osascript_string "$PROJECT")"
  body="$(escape_osascript_string "$BODY")"

  if [[ "${VIBEMETER_NOTIFY_VISUAL:-1}" != "0" ]]; then
    # Prefer the bundled Vibemeter binary so the banner is attributed to
    # Vibemeter and can carry an app icon. Fall back to osascript when the
    # bundle hasn't been built yet (e.g. user never ran `vibemeter float`).
    local data_dir="${VIBEMETER_DATA_DIR:-$HOME/.vibemeter}"
    local app_bin="$data_dir/Vibemeter.app/Contents/MacOS/Vibemeter"
    if [[ -x "$app_bin" ]]; then
      "$app_bin" --notify "$TITLE" "$BODY" "$TOOL" >/dev/null 2>&1 \
        || osascript -e "display notification \"$body\" with title \"$title\" subtitle \"$subtitle\"" >/dev/null 2>&1 \
        || true
    else
      osascript -e "display notification \"$body\" with title \"$title\" subtitle \"$subtitle\"" >/dev/null 2>&1 || true
    fi
  fi

  # SOUND_MODE: voice (default, TTS) | beep (single sound) | off (silent).
  # Legacy VIBEMETER_NOTIFY_SOUND=0 still forces off for back-compat.
  SOUND_MODE="${VIBEMETER_NOTIFY_SOUND_MODE:-voice}"
  if [[ "${VIBEMETER_NOTIFY_SOUND:-1}" == "0" ]]; then SOUND_MODE="off"; fi

  case "$SOUND_MODE" in
    off) ;;
    beep)
      local sound
      case "$STATUS" in
        complete|done|success)                 sound="/System/Library/Sounds/Glass.aiff" ;;
        needs_input|input|intervention|permission) sound="/System/Library/Sounds/Funk.aiff" ;;
        failed|fail|error)                     sound="/System/Library/Sounds/Basso.aiff" ;;
        *)                                     sound="/System/Library/Sounds/Tink.aiff" ;;
      esac
      afplay "$sound" >/dev/null 2>&1 || true
      ;;
    voice|*)
      if [[ -n "$VOICE" ]]; then
        say -v "$VOICE" "$SAY_TEXT" >/dev/null 2>&1 || say "$SAY_TEXT" >/dev/null 2>&1 || true
      else
        say "$SAY_TEXT" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

main "$@"
