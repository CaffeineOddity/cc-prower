#!/bin/bash

# cc-power 开发者配置脚本
# 用于构建和全局安装

set -e

# CLI 名称
CLI_NAME="ccpower"

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
    if [ ! -f "pnpm-workspace.yaml" ] || [ ! -d "cc-power-service" ]; then
        print_error "请在项目根目录运行此脚本（需包含 pnpm-workspace.yaml 等文件）"
        echo "当前目录: $current_dir"
        show_usage
        exit 1
    fi

    # 检查并自动安装 tmux
    if ! command -v tmux &> /dev/null; then
        print_info "未检测到 tmux，尝试自动安装..."

        # 获取操作系统类型
        OS="$(uname -s)"
        case "${OS}" in
            Darwin*)
                if command -v brew &> /dev/null; then
                    print_info "检测到 macOS，使用 Homebrew 安装 tmux..."
                    brew install tmux
                else
                    print_error "未检测到 Homebrew，请先安装 Homebrew 或手动安装 tmux。"
                    exit 1
                fi
                ;;
            Linux*)
                if [ -f /etc/debian_version ]; then
                    print_info "检测到 Debian/Ubuntu，使用 apt-get 安装 tmux..."
                    sudo apt-get update && sudo apt-get install -y tmux
                elif [ -f /etc/redhat-release ]; then
                    print_info "检测到 RHEL/CentOS，使用 yum/dnf 安装 tmux..."
                    if command -v dnf &> /dev/null; then
                        sudo dnf install -y tmux
                    else
                        sudo yum install -y tmux
                    fi
                else
                     print_error "无法确定 Linux 发行版，请手动安装 tmux。"
                     exit 1
                fi
                ;;
            *)
                print_error "不支持的操作系统: ${OS}，请手动安装 tmux。"
                exit 1
                ;;
        esac

        # 再次检查是否安装成功
        if ! command -v tmux &> /dev/null; then
             print_error "tmux 安装失败，请检查错误日志并重试。"
             exit 1
        else
             print_success "tmux 安装成功: $(tmux -V)"
        fi
    else
        print_info "检测到 tmux: $(tmux -V)"
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
    print_info "正在清理旧的全局安装..."

    # 卸载旧的全局安装
    if command -v "$CLI_NAME" &> /dev/null; then
        print_info "检测到已安装的 ${CLI_NAME}，正在卸载..."
        npm unlink -g "$CLI_NAME" > /dev/null 2>&1 || true
        cd cc-power-service && npm unlink -g > /dev/null 2>&1 || true && cd ..
        print_success "旧安装已清理"
    fi

    print_info "正在全局安装 ${CLI_NAME}..."
    cd cc-power-service && npm link && cd ..
    print_success "${CLI_NAME} 已全局安装"
}

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
    print_success "环境配置完成！使用方法："
    echo "  1. 启动 cc-power 服务: ccpower start"
    echo "  2. 在你的项目目录设置 hooks: ccpower setup-hooks [project_path]"
    echo "     (不指定路径则在当前目录设置，也可以指定 . 或其他路径)"
    echo "  3. 运行你的项目: ccpower run . --skip-ask or ccpower run <project_dir> --skip-ask"
    echo "  4. 从聊天平台发送消息，Claude 会自动处理并回复"
    echo ""

    # 询问是否启动服务
    local prompt="${GREEN}是否现在启动 cc-power 服务? (y/enter退出)${NC}"
    read -p "$(echo -e "$prompt")" -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "正在启动 cc-power 服务..."
        ccpower start
    fi
}

# 执行主函数
main