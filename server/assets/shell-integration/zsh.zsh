typeset -g __dh_nonce="$DAM_HOPPER_SHELL_NONCE"; unset DAM_HOPPER_SHELL_NONCE
__dh_emit() {
  if (( $# > 1 )); then
    printf '\e]633;%s;%s;%s\a' "$1" "$2" "$__dh_nonce"
  else
    printf '\e]633;%s;%s\a' "$1" "$__dh_nonce"
  fi
}
__dh_b64() { print -rn -- "$1" | base64 | tr '+/' '-_' | tr -d '=\n'; }
__dh_precmd() { local __dh_exit_status=$?; __dh_emit D "$__dh_exit_status"; __dh_emit A; __dh_emit B; }
__dh_preexec() { printf '\e]633;E;%s;%s\a' "$(__dh_b64 "$1")" "$__dh_nonce"; __dh_emit C; }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __dh_preexec
precmd_functions=(__dh_precmd ${precmd_functions:#__dh_precmd})
