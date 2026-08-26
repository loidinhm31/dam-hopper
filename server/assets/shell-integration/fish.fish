set -l __dh_nonce $DAM_HOPPER_SHELL_NONCE; set -e DAM_HOPPER_SHELL_NONCE
function __dh_emit --argument-names kind exit_code
  if test (count $argv) -gt 1
    printf '\e]633;%s;%s;%s\a' $kind $exit_code $__dh_nonce
  else
    printf '\e]633;%s;%s\a' $kind $__dh_nonce
  end
end
function __dh_prompt --on-event fish_prompt; __dh_emit A; __dh_emit B; end
function __dh_preexec --on-event fish_preexec
  set -l encoded (printf '%s' $argv[1] | base64 | tr '+/' '-_' | tr -d '=\n')
  printf '\e]633;E;%s;%s\a' $encoded $__dh_nonce; __dh_emit C
end
function __dh_postexec --on-event fish_postexec
  set -l __dh_exit_status $status
  __dh_emit D $__dh_exit_status
end
