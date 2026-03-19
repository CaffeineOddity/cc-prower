#!/bin/bash
set -euo pipefail

log_info() {
  echo "[cc-power-save-hook] $*" >&2
}

log_error() {
  echo "[cc-power-save-hook] ERROR: $*" >&2
}

#######################################
# JSON parsing functions
#######################################
json_extract() {
  local json="$1"
  local key="$2"
  local default="${3:-}"

  if command -v jq &> /dev/null; then
    jq -r --arg k "$key" '.[$k] // empty' <<< "$json" 2>/dev/null || echo "$default"
    return
  fi

  # Fallback: simple grep/sed parsing
  local pattern="\"$key\":"
  local value
  value=$(echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed 's/.*:[[:space:]]*"\([^"]*\)".*/\1/' | head -1)
  echo "${value:-$default}"
}

# Escape string for JSON
json_escape() {
  local string="$1"
  if command -v jq &> /dev/null; then
    jq -Rs . <<< "$string"
    return
  fi

  # Fallback: basic escaping
  echo "$string" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n'
}

#######################################
# Config loading functions
#######################################
load_project_config() {
  local project_dir="$1"

  local config_paths=("$project_dir/.cc-power.yaml" "$project_dir/config.yaml")
  for config_path in "${config_paths[@]}"; do
    if [ -f "$config_path" ]; then
      cat "$config_path"
      return
    fi
  done

  return 1
}

yaml_extract() {
  local yaml_content="$1"
  local key="$2"
  local default="${3:-}"

  if command -v yq &> /dev/null; then
    yq ".$key // \"$default\"" <<< "$yaml_content" 2>/dev/null | tr -d '"' || echo "$default"
    return
  fi

  # Fallback: simple grep
  local pattern="^${key}:"
  local value
  value=$(echo "$yaml_content" | grep "^${key}:" | sed "s/^${key}:[[:space:]]*//" | tr -d "'\"" | head -1)
  echo "${value:-$default}"
}

# 读取 hook 输入 (JSON 格式)
HOOK_INPUT=$(cat)

# 获取工作目录
CWD=$(json_extract "$HOOK_INPUT" "cwd")
[ -z "$CWD" ] && CWD=$(pwd)

log_info "Working directory: $CWD"

# 加载项目配置
PROJECT_CONFIG=$(load_project_config "$CWD") || {
  log_error "No config file found in project directory: $CWD"
  exit 1
}

# 提取 provider 和 project_id
PROVIDER=$(yaml_extract "$PROJECT_CONFIG" "provider" "unknown")
PROJECT_ID=$(yaml_extract "$PROJECT_CONFIG" "project_id")

log_info "Project: $PROJECT_ID, Provider: $PROVIDER"

# 将配置信息以key-value形式合并到input
HOOK_INPUT_WITH_CONFIG=""
if command -v jq &> /dev/null; then
  # 将YAML转换为JSON并合并
  if command -v yq &> /dev/null; then
    CONFIG_JSON=$(yq -o=json <<< "$PROJECT_CONFIG" 2>/dev/null)
    HOOK_INPUT_WITH_CONFIG=$(jq --argjson config "$CONFIG_JSON" '. + $config' <<< "$HOOK_INPUT")
  else
    # 如果没有yq，手动提取provider和project_id
    HOOK_INPUT_WITH_CONFIG=$(jq --arg p "$PROVIDER" --arg pid "$PROJECT_ID" '. + {"provider": $p, "project_id": $pid}' <<< "$HOOK_INPUT")
  fi
else
  # Fallback
  HOOK_INPUT_WITH_CONFIG="$HOOK_INPUT"
fi

# 写入路径和文件名（按 stop-signal.sh 的方式）
HOOKS_DIR="${HOME:-}/.cc-power/hooks"
mkdir -p "$HOOKS_DIR"

TIMESTAMP=$(date +%s%3N)
OUTPUT_FILE="$HOOKS_DIR/send-$PROJECT_ID-$TIMESTAMP.json"

# 提取响应内容并写入文件
echo "$HOOK_INPUT_WITH_CONFIG" > "$OUTPUT_FILE"

log_info "Response saved to: $OUTPUT_FILE" >&2
exit 0