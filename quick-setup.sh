#!/bin/bash

# cc-connect-carry 快速启动脚本
# 用于快速重新安装和配置

set -e

echo "🚀 cc-connect-carry 快速配置"

# 重新构建
echo "📦 重新构建..."
npm run build > /dev/null 2>&1

# 重新链接
echo "🔗 重新链接全局..."
npm link > /dev/null 2>&1

# 验证
echo "✅ 验证安装..."
cc-carry --version

echo ""
echo "✨ 配置完成！现在可以运行: claude"