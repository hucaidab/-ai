# ============================================================
# 团队环境变量配置指引（LLM 接入）
# 团队统一使用环境变量，禁止把 api_key 提交进代码库。
# ============================================================

## 需要设置的环境变量

| 变量 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `LLM_API_KEY` | 是 | API 密钥 | `sk-xxxxxxxx` |
| `LLM_BASE_URL` | 否 | API 网关地址（默认 deepseek） | `https://api.deepseek.com` |
| `LLM_MODEL` | 否 | 模型名（默认 deepseek-chat） | `deepseek-chat` |

> 代码读取优先级：环境变量 > `llm.config.json`（后者已被 .gitignore 忽略，仅本机临时用）。

## 一、Windows（本机永久生效）

```bash
setx LLM_API_KEY "sk-xxxxxxxx"
setx LLM_BASE_URL "https://api.deepseek.com"
setx LLM_MODEL "deepseek-chat"
```
> `setx` 设置后**需重新打开终端**才生效。只对当前会话生效（不持久）用：
> ```bash
> export LLM_API_KEY="sk-xxxxxxxx"
> ```

## 二、macOS / Linux（永久生效）

```bash
echo 'export LLM_API_KEY="sk-xxxxxxxx"' >> ~/.zshrc   # zsh
echo 'export LLM_BASE_URL="https://api.deepseek.com"' >> ~/.zshrc
source ~/.zshrc
# bash 用户把 ~/.zshrc 换成 ~/.bashrc
```

## 三、CI / 流水线（GitHub Actions 示例）

```yaml
env:
  LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
  LLM_BASE_URL: ${{ secrets.LLM_BASE_URL }}
  LLM_MODEL: deepseek-chat
```
> 在仓库 Settings → Secrets 中配置，密钥不会出现在日志/代码里。

## 四、验证是否生效

```bash
node -e "import('./llm-model.mjs').then(m => { const c = m.loadLLMConfig(); console.log('base_url:', c.base_url); console.log('model:', c.model); console.log('api_key:', c.api_key ? '已配置(' + c.api_key.slice(0,4) + '***)' : '❌ 未配置'); })"
```

## 五、没有 key 时怎么办

`llm-model.mjs` 自动降级：**LLM → DSL 规则解析 → 知识库模板**。
- 没配 key：直接用模板/DSL 出图（不需要 API）
- 配了 key：自由自然语言直接建模，质量最高
- 两者都不影响 `agent-flow.mjs` 单命令使用

## 六、安全红线

- ❌ 不要把 `api_key` 写进任何提交到 git 的文件
- ❌ 不要用 `echo sk-xxx >> 文件` 把 key 写进仓库
- ✅ key 泄露后立刻到平台后台**吊销并重新生成**
- ✅ 仓库已含 `.gitignore` 忽略 `llm.config.json`，提交前先 `git status` 确认
