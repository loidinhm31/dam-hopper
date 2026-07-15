[[ $- == *i* ]] || return
__dh_nonce="$DAM_HOPPER_SHELL_NONCE"; unset DAM_HOPPER_SHELL_NONCE
__dh_emit() { printf '\e]633;%s;%s\a' "$1" "$__dh_nonce"; }
__dh_prompt() { __dh_emit A; __dh_emit B; }
PROMPT_COMMAND="__dh_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
