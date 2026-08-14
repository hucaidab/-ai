#!/usr/bin/env bash
# ============================================================
# deploy-linux.sh — 流程图工作台部署（Linux 服务器）
# 用法: bash deploy-linux.sh [端口，默认 8080]
# 内网/公网服务器运行后，团队访问 http://服务器IP:端口/generate
# ============================================================
set -e
PORT="${1:-8080}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js（需要 v18+）"
  exit 1
fi

cd "$DIR"
# 已运行则先停
if [ -f .server.pid ] && kill -0 "$(cat .server.pid)" 2>/dev/null; then
  echo "⚠️ 服务已在运行 (PID $(cat .server.pid))，先停止"
  kill "$(cat .server.pid)"
  sleep 1
fi

nohup node preview-server.mjs "$PORT" . > preview-server.log 2>&1 &
echo $! > .server.pid
sleep 1
echo "✅ 流程图工作台已启动（后台运行）"
echo "   生成器: http://localhost:$PORT/generate"
echo "   预览页: http://localhost:$PORT/"
echo "   日志:   preview-server.log"
echo "   停止:   kill \$(cat .server.pid)"
echo ""
echo "   团队访问: http://<服务器IP>:$PORT/generate"
