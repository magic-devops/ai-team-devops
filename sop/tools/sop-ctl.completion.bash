# sop-ctl Bash 补全（配合 alias 使用）
#
#   alias sopctl='bash /绝对路径/仓库/sop/tools/sop-ctl.sh'
#   source /绝对路径/仓库/sop/tools/sop-ctl.completion.bash
#
# 或:
#   eval "$(bash /绝对路径/仓库/sop/tools/sop-ctl.sh complete bash)"
#
_sopctl_global='-y --yes --json --port --project-path -h --help'
_sopctl_cmds='help init reinit backup clean start start-bg restart-bg stop-bg stop status health install repair deploy register doctor sync reset-admin manager bootstrap complete version env logs url open wait-health self-check commands'

_sopctl() {
  local cur=${COMP_WORDS[COMP_CWORD]}
  local i idx
  idx=1
  for ((i=1; i<COMP_CWORD; i++)); do
    case "${COMP_WORDS[i]}" in
      -y|--yes|--json) ;;
      -h|--help) ;;
      --port|--project-path) ((i++)) ;;
      --port=*|--project-path=*) ;;
      *)
        idx=$i
        break
        ;;
    esac
  done

  if [[ $COMP_CWORD -lt $idx ]]; then
    COMPREPLY=( $(compgen -W "$_sopctl_global" -- "$cur") )
    return
  fi
  if [[ $COMP_CWORD -eq $idx ]]; then
    COMPREPLY=( $(compgen -W "$_sopctl_cmds" -- "$cur") )
    return
  fi

  local sub="${COMP_WORDS[idx]}"
  case "$sub" in
    deploy)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "single saas" -- "$cur") )
      ;;
    backup)
      COMPREPLY=( $(compgen -W "--full" -- "$cur") )
      ;;
    clean)
      COMPREPLY=( $(compgen -W "--apply" -- "$cur") )
      ;;
    start|start-bg|restart-bg)
      COMPREPLY=( $(compgen -W "--port --no-reload" -- "$cur") )
      ;;
    stop-bg|stop)
      COMPREPLY=( $(compgen -W "--force" -- "$cur") )
      ;;
    repair)
      COMPREPLY=( $(compgen -W "--strict" -- "$cur") )
      ;;
    complete)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "bash zsh" -- "$cur") )
      ;;
    logs)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "-f --follow 20 50 100 200 500" -- "$cur") )
      elif [[ $COMP_CWORD -eq $((idx+2)) ]] && [[ "${COMP_WORDS[idx+1]}" == -f || "${COMP_WORDS[idx+1]}" == --follow ]]; then
        COMPREPLY=( $(compgen -W "20 50 100 200 500" -- "$cur") )
      fi
      ;;
    wait-health)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "--timeout" -- "$cur") )
      elif [[ "${COMP_WORDS[COMP_CWORD-1]}" == "--timeout" ]]; then
        COMPREPLY=( $(compgen -W "30 60 120 300" -- "$cur") )
      fi
      ;;
  esac
}

complete -o default -F _sopctl sopctl
