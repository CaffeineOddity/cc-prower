#!/bin/bash

# cc-connect-carry 开发者配置脚本
# 用于构建和全局安装 cc-carry

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 显示使用说明
show_usage() {
    echo "用法: ./setup.sh"
    echo ""
    echo "此脚本在 cc-connect-carry 目录运行，用于:"
    echo "  - 构建 cc-connect-carry"
    echo "  - 全局安装 cc-carry"
    echo ""
}

# 检查是否在 cc-connect-carry 目录
if [ "$(basename $(pwd))" != "cc-connect-carry" ]; then
    print_error "请在 cc-connect-carry 根目录运行此脚本"
    echo "当前目录: $(pwd)"
    show_usage
    exit 1
fi

echo ""
echo "======================================"
echo "  cc-connect-carry 开发者配置"
echo "======================================"
echo ""

print_info "当前目录: $(pwd)"

# 构建
print_info "正在构建..."
npm run build > /dev/null 2>&1
print_success "构建完成"

# 全局安装
print_info "正在全局安装 cc-carry..."
npm link > /dev/null 2>&1

# 验证
if command -v cc-carry &> /dev/null; then
    print_success "cc-carry 已安装: $(which cc-carry)"
    cc-carry --version
else
    print_warning "cc-carry 未在 PATH 中"
fi

echo ""
print_success "开发者配置完成！"
echo ""
echo "下一步: 在你的项目目录运行"
echo "  ./setup-project-mcp.sh /path/to/your-project"
echo ""