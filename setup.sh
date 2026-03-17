#!/bin/bash

# cc-power 开发者配置脚本
# 用于构建和全局安装

set -e

# CLI 名称
CLI_NAME="cc-power"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印信息辅助函数
# 打印普通信息
print_info() { printf "%b%s%b %s\n" "$BLUE" "[INFO]" "$NC" "$1"; }
# 打印成功信息
print_success() { printf "%b%s%b %s\n" "$GREEN" "[SUCCESS]" "$NC" "$1"; }
# 打印警告信息
print_warning() { printf "%b%s%b %s\n" "$YELLOW" "[WARNING]" "$NC" "$1"; }
# 打印错误信息
print_error() { printf "%b%s%b %s\n" "$RED" "[ERROR]" "$NC" "$1"; }

# 显示使用说明
# 打印脚本的用法和功能介绍
show_usage() {
    echo "用法: ./setup.sh"
    echo ""
    echo "此脚本在项目根目录运行，用于:"
    echo "  - 构建 ${CLI_NAME}"
    echo "  - 全局安装 ${CLI_NAME}"
    echo ""
}

# 检查运行目录是否正确
# 确保脚本在项目根目录执行，否则退出并提示错误
check_directory() {
    local current_dir
    current_dir=$(pwd)
    if [ ! -f "pnpm-workspace.yaml" ] || [ ! -d "cc-power" ] || [ ! -d "cc-power-mcp" ]; then
        print_error "请在项目根目录运行此脚本（需包含 pnpm-workspace.yaml 等文件）"
        echo "当前目录: $current_dir"
        show_usage
        exit 1
    fi
}

# 构建项目
# 安装依赖并执行 pnpm run build 进行项目构建
build_project() {
    print_info "正在安装依赖..."
    pnpm install
    print_info "正在构建..."
    pnpm run build
    print_success "构建完成"
}

# 全局安装CLI
# 进入对应子目录执行 npm link 操作
install_global() {
    print_info "正在全局安装 ${CLI_NAME}..."
    cd cc-power-mcp && npm link && cd ..
    cd cc-power && npm link cc-power-mcp && npm link && cd ..
}

# 验证安装结果
# 检查命令是否可以在全局 PATH 中找到并打印版本号
verify_installation() {
    if command -v "$CLI_NAME" &> /dev/null; then
        print_success "${CLI_NAME} 已安装: $(which "$CLI_NAME")"
        "$CLI_NAME" --version
    else
        print_warning "${CLI_NAME} 未在 PATH 中"
    fi
}

# 主函数
# 协调执行各个步骤
main() {
    check_directory
    
    echo ""
    echo "======================================"
    echo "  ${CLI_NAME} 开发者配置"
    echo "======================================"
    echo ""
    
    print_info "当前目录: $(pwd)"
    
    build_project
    install_global
    verify_installation
    
    echo ""
    print_success "开发者配置完成！"
    echo ""
    
    read -p "是否为项目配置 MCP? [y/N] (直接回车退出): " setup_mcp_choice
    if [[ "$setup_mcp_choice" =~ ^[Yy]$ ]]; then
        read -p "请输入项目目录路径: " project_path
        if [ -n "$project_path" ]; then
            if [ -f "./setup-project-mcp.sh" ]; then
                bash ./setup-project-mcp.sh "$project_path"
            else
                print_error "找不到 setup-project-mcp.sh 脚本"
            fi
        else
            print_warning "未输入路径，退出配置。"
        fi
    else
        print_info "已退出。"
    fi
    echo ""
}

# 执行主函数
main
