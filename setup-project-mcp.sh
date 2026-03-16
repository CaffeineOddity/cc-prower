#!/bin/bash

# 项目 MCP 配置脚本
# 接受项目路径作为参数，在该项目中配置 MCP 服务器

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

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

# 检查参数
if [ -z "$1" ]; then
    print_error "缺少项目路径参数"
    show_usage
    exit 1
fi

PROJECT_PATH="$1"

# 转换为绝对路径
if [[ "$PROJECT_PATH" != /* ]]; then
    PROJECT_PATH="$(cd "$(dirname "$PROJECT_PATH")" && pwd)/$(basename "$PROJECT_PATH")"
fi

# 检查项目目录是否存在
if [ ! -d "$PROJECT_PATH" ]; then
    print_error "项目目录不存在: $PROJECT_PATH"
    exit 1
fi

# 检查 cc-carry 是否已安装
if ! command -v cc-carry &> /dev/null; then
    print_error "cc-carry 未安装"
    echo ""
    echo "请先在 cc-connect-carry 目录运行:"
    echo "  cd /path/to/cc-connect-carry"
    echo "  ./setup.sh"
    exit 1
fi

echo ""
echo "======================================"
echo "  项目 MCP 配置"
echo "======================================"
echo ""

PROJECT_NAME=$(basename "$PROJECT_PATH")
print_info "项目路径: $PROJECT_PATH"
print_info "项目名称: $PROJECT_NAME"
print_success "cc-carry 已安装: $(which cc-carry)"

# 进入项目目录
cd "$PROJECT_PATH"

# 检查是否已有配置
CONFIG_FILES=(".cc-carry.yaml" "cc-carry.yaml" "config.yaml")
CONFIG_FILE=""

for file in "${CONFIG_FILES[@]}"; do
    if [ -f "$file" ]; then
        CONFIG_FILE="$file"
        print_info "发现现有配置: $CONFIG_FILE"
        break
    fi
done

# 如果没有配置文件，询问创建
if [ -z "$CONFIG_FILE" ]; then
    echo ""
    echo "未找到项目配置文件"
    echo "请选择:"
    echo "  1) 创建新的飞书配置"
    echo "  2) 创建新的 Telegram 配置"
    echo "  3) 跳过配置"
    echo ""
    read -p "请选择 (1-3): " choice

    case $choice in
        1)
            CONFIG_FILE=".cc-carry.yaml"
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
            print_success "已创建配置文件: $PROJECT_PATH/$CONFIG_FILE"
            print_warning "请更新 $CONFIG_FILE 中的凭证信息"
            ;;
        2)
            CONFIG_FILE="cc-carry.yaml"
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
            print_success "已创建配置文件: $PROJECT_PATH/$CONFIG_FILE"
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
fi

# 配置 MCP
echo ""
print_info "配置 MCP 服务器..."

# 检查是否已配置
if claude mcp list 2>&1 | grep -q "chat-provider"; then
    print_warning "chat-provider MCP 服务器已存在"
    read -p "是否重新配置? (y/N): " reconfig
    if [[ ! $reconfig =~ ^[Yy]$ ]]; then
        print_info "保持现有配置"
    else
        print_info "移除现有配置..."
        claude mcp remove chat-provider -s local > /dev/null 2>&1 || true
        print_info "添加新的 MCP 服务器..."
        if claude mcp add chat-provider -- cc-carry start > /dev/null 2>&1; then
            print_success "MCP 服务器配置成功"
        else
            print_error "MCP 服务器配置失败"
        fi
    fi
else
    print_info "添加 MCP 服务器..."
    if claude mcp add chat-provider -- cc-carry start > /dev/null 2>&1; then
        print_success "MCP 服务器配置成功"
    else
        print_error "MCP 服务器配置失败"
    fi
fi

# 验证
echo ""
print_info "验证配置..."

echo ""
echo "=== MCP 服务器状态 ==="
claude mcp list 2>&1 | grep -E "(chat-provider|Checking)" || echo "  chat-provider 未配置"

echo ""
print_success "配置完成！"
echo ""
echo "使用方法:"
echo "  cd $PROJECT_PATH"
echo "  claude"
echo ""
echo "可用工具:"
echo "  - send_message: 发送消息"
echo "  - list_chats: 列出聊天"
echo "  - get_status: 获取状态"
echo ""