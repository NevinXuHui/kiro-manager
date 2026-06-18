#!/bin/bash

# Kiro Manager 启动脚本

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================${NC}"
echo -e "${BLUE}   Kiro Manager 启动脚本${NC}"
echo -e "${BLUE}==================================${NC}"
echo ""

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 Node.js，请先安装 Node.js${NC}"
    exit 1
fi

# 检查 npm 是否安装
if ! command -v npm &> /dev/null; then
    echo -e "${RED}错误: 未找到 npm，请先安装 npm${NC}"
    exit 1
fi

# 加载 Rust 环境 (如果已安装)
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

# 检查 Rust 是否安装
if ! command -v cargo &> /dev/null; then
    echo -e "${YELLOW}警告: 未找到 Rust/Cargo，Tauri 应用需要 Rust 环境${NC}"
    echo -e "${YELLOW}请访问 https://rustup.rs/ 安装 Rust${NC}"
fi

# 检查依赖是否已安装
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}未找到 node_modules 目录，正在安装依赖...${NC}"
    npm install
    echo -e "${GREEN}✓ 依赖安装完成${NC}"
    echo ""
fi

# 显示菜单
echo -e "${GREEN}请选择运行模式:${NC}"
echo -e "  ${BLUE}1)${NC} Tauri 开发模式 (推荐 - 完整的桌面应用)"
echo -e "  ${BLUE}2)${NC} Vite 开发模式 (仅 Web 前端)"
echo -e "  ${BLUE}3)${NC} 构建生产版本"
echo -e "  ${BLUE}4)${NC} 预览生产版本"
echo ""

read -p "请输入选项 (1-4, 默认: 1): " choice
choice=${choice:-1}

case $choice in
    1)
        echo -e "${GREEN}启动 Tauri 开发模式...${NC}"
        npm run tauri dev
        ;;
    2)
        echo -e "${GREEN}启动 Vite 开发服务器...${NC}"
        npm run dev
        ;;
    3)
        echo -e "${GREEN}构建生产版本...${NC}"
        npm run build
        echo -e "${GREEN}✓ 构建完成${NC}"
        ;;
    4)
        echo -e "${GREEN}预览生产版本...${NC}"
        npm run preview
        ;;
    *)
        echo -e "${RED}无效的选项${NC}"
        exit 1
        ;;
esac
