# sop Bash 补全（静态增强，配合 Typer 动态补全或单独 source）
#
#   eval "$(sop completion show bash)"
#   source /path/to/packages/sop-cli/sop_cli/completions/sop.bash
#
_sop_global='-h --help -V --version --install-completion --show-completion'
_sop_cmds='help init register login context memory kb copilot db-config ops pages platforms status agentd requirement issue task sprint work event usage rule sync doctor llm commands completion'

_sop_help_opts='--examples -e --group -g'
_sop_init_opts='--manager --pair-code --name'
_sop_register_opts='--manager --code --username --no-init'
_sop_login_opts='--pair --manager --code --username --tenant'
_sop_agentd_cmds='start stop status logs install'
_sop_agentd_opts='--foreground -f -n'
_sop_sync_cmds='pull push enqueue push-file enqueue-file watch flush compact doctor repair status'
_sop_sync_opts='--cursor --modules -m --out -o --direct --materialize --dry-run --once --local'
_sop_requirement_cmds='list create update delete'
_sop_requirement_opts='--status --priority --page --size --assigned-agent --dev-tool --acceptance --local'
_sop_issue_cmds='list create update resolve delete'
_sop_issue_opts='--status --severity --priority --page --size --type --local'
_sop_task_cmds='list create update pull done fail delete issue'
_sop_task_opts='--status --priority --page --size --notes --confidence --severity --desc --assignee --local'
_sop_task_status='pending in_progress blocked completed cancelled review'
_sop_sprint_cmds='list create update complete progress delete'
_sop_sprint_opts='--status --points --completion --page --size --local'
_sop_work_cmds='summary list next export'
_sop_work_opts='--local --json --out --status --priority'
_sop_event_cmds='emit flush list subscribe'
_sop_event_opts='--data --json --local --type --limit'
_sop_usage_cmds='record flush summary quota check'
_sop_usage_opts='--json --local --unit --source --limit'
_sop_db_config_cmds='drivers list add test delete export'
_sop_db_config_opts='--json --type --role --capability --host --port --database --username --secret-ref --url'
_sop_platforms_cmds='list init doctor install-shims'
_sop_pages_cmds='list manifest capabilities'
_sop_pages_opts='--view --domain --status --q --json'
_sop_memory_cmds='health recent search add forget summarize attach-run flush'
_sop_kb_cmds='search rag add flush index job'
_sop_copilot_cmds='ask sessions show classify summarize suggest'
_sop_context_cmds='show json services manifest env prepare'
_sop_rule_cmds='list propose apply flush'
_sop_llm_cmds='chat embed search'
_sop_ops_cmds='health stack deploy snapshot notify-channels notify-test sync-pull worker-health'
_sop_completion_cmds='install show doctor'
_sop_example_groups='接入与登录 健康与上下文 同步 交付工作台 知识、记忆与规则 AI、事件与用量 补全'

_sop() {
  local cur=${COMP_WORDS[COMP_CWORD]}
  local prev=${COMP_WORDS[COMP_CWORD-1]}
  local i idx=1

  for ((i=1; i<COMP_CWORD; i++)); do
    case "${COMP_WORDS[i]}" in
      -h|--help|-V|--version) ;;
      --install-completion|--show-completion) ((i++)) ;;
      --manager|--code|--username|--tenant|--cursor|--modules|-m|--out|-o|--status|--priority|--page|--size|--notes|--confidence|--severity|--desc|--shell|-s|--path|-n|--group|-g) ((i++)) ;;
      --manager=*|--code=*|--username=*|--tenant=*|--cursor=*|--modules=*|--out=*|--status=*|--priority=*|--page=*|--size=*|--notes=*|--confidence=*|--severity=*|--desc=*|--shell=*|--path=*|--group=*|--pair) ;;
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
    help)
      if [[ "$prev" == "--group" || "$prev" == "-g" ]]; then
        COMPREPLY=( $(compgen -W "$_sop_example_groups" -- "$cur") )
      elif [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_cmds $_sop_help_opts" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_help_opts" -- "$cur") )
      fi
      ;;
    init)
      COMPREPLY=( $(compgen -W "$_sop_init_opts" -- "$cur") )
      ;;
    register)
      COMPREPLY=( $(compgen -W "$_sop_register_opts" -- "$cur") )
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
    requirement)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_requirement_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_requirement_opts" -- "$cur") )
      fi
      ;;
    issue)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_issue_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_issue_opts" -- "$cur") )
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
    sprint)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_sprint_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_sprint_opts" -- "$cur") )
      fi
      ;;
    work)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_work_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_work_opts" -- "$cur") )
      fi
      ;;
    event)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_event_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_event_opts" -- "$cur") )
      fi
      ;;
    usage)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_usage_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_usage_opts" -- "$cur") )
      fi
      ;;
    db-config)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_db_config_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_db_config_opts" -- "$cur") )
      fi
      ;;
    platforms)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_platforms_cmds" -- "$cur") )
      fi
      ;;
    pages)
      if [[ $COMP_CWORD -eq $((idx+1)) ]]; then
        COMPREPLY=( $(compgen -W "$_sop_pages_cmds" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$_sop_pages_opts" -- "$cur") )
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
    commands)
      if [[ "$prev" == "--group" || "$prev" == "-g" ]]; then
        COMPREPLY=( $(compgen -W "$_sop_example_groups" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "--json --examples -e --group -g -h --help" -- "$cur") )
      fi
      ;;
    doctor|status)
      COMPREPLY=( $(compgen -W "--json -h --help" -- "$cur") )
      ;;
  esac
}

complete -o default -o bashdefault -F _sop sop
