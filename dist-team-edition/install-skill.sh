#!/bin/sh
# ============================================================
# install-skill.sh — 流程图技能包一键安装（macOS / Linux）
# 运行：终端执行  sh install-skill.sh
# 自动把 flowchart-agent 复制到 WorkBuddy 技能目录
# ============================================================
SKILL_SRC="$(cd "$(dirname "$0")" && pwd)/flowchart-agent"
SKILL_DST="$HOME/.workbuddy/skills/flowchart-agent"

if [ ! -f "$SKILL_SRC/SKILL.md" ]; then
  echo "[错误] 未找到技能包源目录（install-skill.sh 需与 flowchart-agent 文件夹同级）"
  exit 1
fi

echo "[1/2] 创建技能目录..."
mkdir -p "$HOME/.workbuddy/skills"

echo "[2/2] 复制技能包..."
cp -R "$SKILL_SRC"/. "$SKILL_DST"/

echo ""
echo "✅ 安装完成！技能包已安装到："
echo "   $SKILL_DST"
echo ""
echo "下一步："
echo "  1. 重启 WorkBuddy"
echo "  2. 对话里直接说：画一个采购审批流程图，采购员发起，采购经理审批"
echo "  3. 或打开编辑器：sh scripts/deploy-linux.sh"
echo ""
