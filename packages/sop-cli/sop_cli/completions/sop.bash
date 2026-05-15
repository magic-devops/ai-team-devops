# sop Bash 补全（静态增强，配合 Typer 动态补全或单独 source）
#
#   eval "$(sop completion show bash)"
#   source /path/to/packages/sop-cli/sop_cli/completions/sop.bash
#
_sop_global='-h --help -V --version --install-completion --show-completion'
_sop_cmds='init login context memory kb copilot ops platforms status agentd task rule sync doctor llm commands completion'

_sop_init_opts='--manager --pair-code --name'
_sop_login_opts='--pair --manager --code --username --tenant'
_sop_agentd_cmds='start stop status logs install'
_sop_agentd_opts='--foreground -f -n'
_sop_sync_cmds='pull push status'
_sop_sync_opts='--cursor --modules -m --out -o --direct'
_sop_task_cmds='list pull done fail issue'
_sop_task_opts='--status --priority --page --size --notes --confidence --severity --desc'
_sop_task_status='pending in_progress blocked completed cancelled review'
_sop_platforms_cmds='list doctor install-shims'
_sop_memory_cmds='health recent search add'
_sop_kb_cmds='search rag add index job'
_sop_copilot_cmds='ask classify summarize suggest'
_sop_context_cmds='show json'
_sop_rule_cmds='list propose'
_sop_llm_cmds='chat embed search'
_sop_ops_cmds='notify-channels notify-test sync-pull worker-health'
_sop_completion_cmds='install show doctor'

_sop() {
  local cur=${COMP_WORDS[COMP_CWORD]}
  local prev=${COMP_WORDS[COMP_CWORD-1]}
  local i idx=1

  for ((i=1; i<COMP_CWORD; i++)); do
    case "${COMP_WORDS[i]}" in
      -h|--help|-V|--version) ;;
      --install-completion|--show-completion) ((i++)) ;;
      --manager|--code|--username|--tenant|--cursor|--modules|-m|--out|-o|--status|--priority|--page|--size|--notes|--confidence|--severity|--desc|--shell|-s|--path|-n) ((i++)) ;;
      --manager=*|--code=*|--username=*|--tenant=*|--cursor=*|--modules=*|--out=*|--status=*|--priority=*|--page=*|--size=*|--notes=*|--confidence=*|--severity=*|--desc=*|--shell=*|--path=*|--pair) ;;
      *)
        idx=$i
        break
        ;;
    esac
  done

  if [[ $COMP_CWORD -le $idx ]]; then
    if [[ $cur == -* ]]; then
      COMPREPLY=( $(compgen -W "$_sop_global" -- "$cur") )
    else
      COMPREPLY=( $(compgen -W "$_sop_cmds" -- "$cur") )
    fi
    return
  fi

  local top="${COMP_WORDS[idx]}"
  local sub="${COMP_WORDS[idx+1]:-}"

  case "$top" in
    init)
      COMPREPLY=( $(compgen -W "$_sop_init_opts" -- "$cur") )
      ;;
    login)
      COMPREPLY=( $(compgen -W "$_sop_login_opts" -- "$cur") )
      ;;
    agentd)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_agentd_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_agentd_opts" -- "$cur") )
      fi
      ;;
    sync)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_sync_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_sync_opts" -- "$cur") )
      fi
      ;;
    task)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_task_cmds" -- "$cur") )
      elif [[ "$prev" == "--status" ]]; then
        COMPREPLY=( $(compgen -W "$_sop_task_status" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_task_opts" -- "$cur") )
      fi
      ;;
    platforms)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_platforms_cmds" -- "$cur") )
      fi
      ;;
    memory)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "$_sop_memory_cmds" -- "$cur") )
      ;;
    kb)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "$_sop_kb_cmds" -- "$cur") )
      ;;
    copilot)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "$_sop_copilot_cmds" -- "$cur") )
      ;;
    context)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "$_sop_context_cmds" -- "$cur") )
      ;;
    rule)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "$_sop_rule_cmds" -- "$cur") )
      ;;
    llm)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "$_sop_llm_cmds" -- "$cur") )
      ;;
    ops)
      [[ $COMP_CWORD -eq $((idx+1)) ]] && COMPREPLY=( $(compgen -W "$_sop_ops_cmds" -- "$cur") )
      ;;
    completion)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_completion_cmds" -- "$cur") )
      elif [[ "$sub" == "install" || "$sub" == "show" ]] && [[ $COMP_CWORD -eq $((idx+2)) ]]; then
        COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "--shell -s --static --path" -- "$cur") )
      fi
      ;;
    doctor|status|commands)
      COMPREPLY=( $(compgen -W "--json --examples -e -h --help" -- "$cur") )
      ;;
  esac
}

complete -o default -o bashdefault -F _sop sop
