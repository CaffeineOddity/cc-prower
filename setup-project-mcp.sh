#!/bin/bash

# 项目 MCP 配置脚本
# 接受项目路径作为参数，在该项目中配置 MCP 服务器

if [ -z "${BASH_VERSION:-}" ]; then
    script_path="$0"
    if [ ! -f "$script_path" ]; then
        script_path="$(ps -p $$ -o args= | awk '{print $2}')"
    fi
    exec /bin/bash "$script_path" "$@"
fi

set -e

SCRIPT_PATH="$0"
if [ ! -f "$SCRIPT_PATH" ]; then
    SCRIPT_PATH="$(ps -p $$ -o args= | awk '{print $2}')"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

# CLI 名称和配置文件
CLI_NAME="cc-power"
MCP_NAME="cc-power-mcp"
CONFIG_FILES=(".cc-power.yaml" "cc-power.yaml" "config.yaml")

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() { printf "%b%s%b %s\n" "$BLUE" "[INFO]" "$NC" "$1"; }
print_success() { printf "%b%s%b %s\n" "$GREEN" "[SUCCESS]" "$NC" "$1"; }
print_warning() { printf "%b%s%b %s\n" "$YELLOW" "[WARNING]" "$NC" "$1"; }
print_error() { printf "%b%s%b %s\n" "$RED" "[ERROR]" "$NC" "$1"; }

# 显示使用说明
show_usage() {
    echo "用法: ./setup-project-mcp.sh <项目路径>"
    echo ""
    echo "参数:"
    echo "  <项目路径>  要配置的项目目录路径"
    echo ""
    echo "示例:"
    echo "  ./setup-project-mcp.sh /Users/username/projects/myapp"
    echo "  ./setup-project-mcp.sh ../my-project"
    echo ""
}

require_project_path_arg() {
    local project_path_arg="${1:-}"

    if [ -z "$project_path_arg" ]; then
        print_error "缺少项目路径参数"
        show_usage
        exit 1
    fi
}

to_absolute_path() {
    local input_path="$1"

    if [[ "$input_path" != /* ]]; then
        echo "$(cd "$(dirname "$input_path")" && pwd)/$(basename "$input_path")"
        return 0
    fi

    echo "$input_path"
}

ensure_project_dir_exists() {
    local project_path="$1"

    if [ ! -d "$project_path" ]; then
        print_error "项目目录不存在: $project_path"
        exit 1
    fi
}

ensure_cli_installed() {
    local cli_name="$1"

    if ! command -v "$cli_name" &> /dev/null; then
        print_error "${cli_name} 未安装"
        echo ""
        echo "请先在项目根目录运行:"
        echo "  cd /path/to/project-root"
        echo "  ./setup.sh"
        exit 1
    fi
}

ensure_repo_built() {
    if [ ! -f "$SCRIPT_DIR/package.json" ]; then
        print_warning "未找到项目根目录 package.json，跳过构建"
        return 0
    fi

    if ! command -v pnpm &> /dev/null; then
        print_warning "pnpm 未安装，跳过构建"
        return 0
    fi

    echo ""
    print_info "构建 cc-power 与 cc-power-mcp..."
    pnpm -C "$SCRIPT_DIR" run build
    print_success "构建完成"
}

print_project_header() {
    local project_path="$1"
    local project_name
    project_name="$(basename "$project_path")"

    echo ""
    echo "======================================"
    echo "  项目 MCP 配置"
    echo "======================================"
    echo ""

    print_info "项目路径: $project_path"
    print_info "项目名称: $project_name"
    print_success "${CLI_NAME} 已安装: $(command -v "$CLI_NAME")"
}

discover_existing_config() {
    CONFIG_FILE=""

    local file
    for file in "${CONFIG_FILES[@]}"; do
        if [ -f "$file" ]; then
            CONFIG_FILE="$file"
            print_info "发现现有配置: $CONFIG_FILE"
            return 0
        fi
    done
}

create_config_template() {
    local choice="$1"
    local project_path="$2"

    case "$choice" in
        1)
            CONFIG_FILE=".cc-power.yaml"
            print_info "创建飞书配置模板..."
            cat > "$CONFIG_FILE" << 'EOF'
provider: "feishu"

feishu:
  # 从飞书开放平台获取的凭证
  # 访问 https://open.feishu.cn/ 创建企业自建应用
  app_id: "cli_your_app_id_here"
  app_secret: "your_app_secret_here"
  bot_name: "Claude Bot"

session:
  max_history: 50
  timeout_minutes: 30
EOF
            print_success "已创建配置文件: $project_path/$CONFIG_FILE"
            print_warning "请更新 $CONFIG_FILE 中的凭证信息"
            ;;
        2)
            CONFIG_FILE="cc-power.yaml"
            print_info "创建 Telegram 配置模板..."
            cat > "$CONFIG_FILE" << 'EOF'
provider: "telegram"

telegram:
  # 从 @BotFather 获取
  bot_token: "your_bot_token_here"

session:
  max_history: 50
  timeout_minutes: 30
EOF
            print_success "已创建配置文件: $project_path/$CONFIG_FILE"
            print_warning "请更新 $CONFIG_FILE 中的凭证信息"
            ;;
        3)
            print_info "跳过配置创建"
            ;;
        *)
            print_error "无效选择"
            exit 1
            ;;
    esac
}

ensure_project_config() {
    local project_path="$1"

    discover_existing_config
    if [ -n "$CONFIG_FILE" ]; then
        return 0
    fi

    echo ""
    echo "未找到项目配置文件"
    echo "请选择:"
    echo "  1) 创建新的飞书配置"
    echo "  2) 创建新的 Telegram 配置"
    echo "  3) 跳过配置"
    echo ""
    read -p "请选择 (1-3): " choice

    create_config_template "$choice" "$project_path"
}

mcp_server_exists() {
    claude mcp list 2>&1 | grep -q "$MCP_NAME"
}

remove_existing_mcp_server() {
    claude mcp remove "$MCP_NAME" -s local > /dev/null 2>&1 || true
}

prepare_mcp_configuration() {
    MCP_ADD_MESSAGE="添加 MCP 服务器..."

    if ! mcp_server_exists; then
        return 0
    fi

    print_warning "$MCP_NAME MCP 服务器已存在"
    read -p "是否重新配置? (y/N): " reconfig
    if [[ ! $reconfig =~ ^[Yy]$ ]]; then
        print_info "保持现有配置"
        return 1
    fi

    print_info "移除现有配置..."
    remove_existing_mcp_server
    MCP_ADD_MESSAGE="添加新的 MCP 服务器..."
    return 0
}

configure_mcp_server() {
    local project_path="$1"

    echo ""
    print_info "配置 MCP 服务器... (仅支持 STDIO 模式)"

    if ! prepare_mcp_configuration; then
        return 0
    fi

    print_info "$MCP_ADD_MESSAGE"
    if claude mcp add "$MCP_NAME" -- "$CLI_NAME" start --stdio > /dev/null 2>&1; then
        print_success "MCP 服务器配置成功"
    else
        print_error "MCP 服务器配置失败"
    fi
}

verify_configuration() {
    echo ""
    print_info "验证配置..."

    echo ""
    echo "=== MCP 服务器状态 ==="
    claude mcp list 2>&1 | grep -E "$MCP_NAME|Checking" || echo "  $MCP_NAME 未配置"
}

print_post_instructions() {
    local project_path="$1"

    echo ""
    print_success "配置完成！"
    echo ""
    echo "使用方法:"
    echo "  cd $project_path"
    echo "  cc-power run ."
    echo ""
    echo "注意: 使用 cc-power run 命令启动项目以获得 Tmux 会话集成和自动唤醒功能"
    echo "传统 claude 命令将不会触发这些高级功能"
    echo ""
    echo "查看项目状态: cc-power status"
    echo "查看项目日志: cc-power logs <project-name>"
}

main() {
    require_project_path_arg "${1:-}"

    PROJECT_PATH="$(to_absolute_path "$1")"
    ensure_project_dir_exists "$PROJECT_PATH"
    ensure_cli_installed "$CLI_NAME"
    print_project_header "$PROJECT_PATH"
    ensure_repo_built

    cd "$PROJECT_PATH"
    ensure_project_config "$PROJECT_PATH"

    # 默认使用 STDIO 模式，不再询问
    configure_mcp_server "$PROJECT_PATH"

    # 跳过 Claude Code hooks 配置，因为现在使用 cc-power run 命令

    verify_configuration
    print_post_instructions "$PROJECT_PATH"
}

main "$@"