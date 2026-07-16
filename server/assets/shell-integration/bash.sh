[[ $- == *i* ]] || return

__dh_nonce="$DAM_HOPPER_SHELL_NONCE"
unset DAM_HOPPER_SHELL_NONCE

# Bash has no native preexec hook. DEBUG is safe to compose only when the user
# has not installed one already; otherwise this adapter stays entirely disabled.
[[ -n $(trap -p DEBUG) ]] && return

__dh_prompt_seen=0
__dh_in_prompt=0
__dh_in_preexec=0
__dh_command_captured=0
__dh_emit() { printf '\e]633;%s;%s\a' "$1" "$__dh_nonce"; }
__dh_b64() { printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '=\n'; }

__dh_prompt_start() {
  __dh_in_prompt=1
  __dh_command_captured=0
  if (( __dh_prompt_seen )); then __dh_emit D; fi
  __dh_prompt_seen=1
  __dh_emit A
  __dh_emit B
}

__dh_prompt_end() { __dh_in_prompt=0; }

__dh_debug() {
  (( __dh_in_prompt || __dh_command_captured || __dh_in_preexec )) && return
  __dh_in_preexec=1
  local command="$1"
  local history_line

  # BASH_COMMAND normalizes leading whitespace. Compare it with the current
  # history entry so commands whose exact bytes are unavailable fail closed.
  history_line="$(fc -ln "$HISTCMD" "$HISTCMD" 2>/dev/null)"
  if [[ "$history_line" != $'\t '* ]]; then
    __dh_command_captured=1
    __dh_in_preexec=0
    return
  fi
  history_line="${history_line:2}"
  if [[ "$history_line" != "$command" ]]; then
    __dh_command_captured=1
    __dh_in_preexec=0
    return
  fi

  # BASH_COMMAND is not lossless for compound, multiline, substitution, or
  # redirection syntax. Do not submit an approximation to browser history.
  case "$command" in
    ""|*'&&'*|*'||'*|*';'*|*'|'*|*'<'*|*'>'*|*'$('*|*'`'*|*'{'*|*'}'*|*'('*|*')'*|*$'\n'*)
      __dh_command_captured=1
      __dh_in_preexec=0
      return
      ;;
  esac

  local encoded
  encoded="$(__dh_b64 "$command")"
  if [[ -z "$encoded" ]]; then
    __dh_command_captured=1
    __dh_in_preexec=0
    return
  fi
  printf '\e]633;E;%s;%s\a' "$encoded" "$__dh_nonce"
  __dh_emit C
  __dh_command_captured=1
  __dh_in_preexec=0
}

__dh_install_prompt_hooks() {
  if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
    local -a __dh_user_prompt=("${PROMPT_COMMAND[@]}")
    PROMPT_COMMAND=(__dh_prompt_start "${__dh_user_prompt[@]}" __dh_prompt_end)
  else
    local __dh_user_prompt="${PROMPT_COMMAND-}"
    if [[ -n "$__dh_user_prompt" ]]; then
      PROMPT_COMMAND="__dh_prompt_start; ${__dh_user_prompt}; __dh_prompt_end"
    else
      PROMPT_COMMAND="__dh_prompt_start; __dh_prompt_end"
    fi
  fi
}

__dh_install_prompt_hooks
trap '__dh_debug "$BASH_COMMAND"' DEBUG
