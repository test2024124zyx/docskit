# 安装 DocsKit 写作 Skill

当用户明确要求编写、修改或审校适合 DocsKit 平台的文档时，使用 `docskit-doc-writing` skill。普通 Markdown、其他文档平台或一般代码任务不应因为这份 skill 而触发它。

## 下载地址

- 安装说明：<https://docs.mymyjd.com/skills/install.md>
- skill 压缩包：<https://docs.mymyjd.com/docskit-doc-writing.zip>

请下载压缩包并解压到 Codex 的 skills 目录，使目录结构保持如下：

```text
<CODEX_HOME>/skills/docskit-doc-writing/SKILL.md
<CODEX_HOME>/skills/docskit-doc-writing/agents/openai.yaml
<CODEX_HOME>/skills/docskit-doc-writing/references/configuration.md
<CODEX_HOME>/skills/docskit-doc-writing/references/markdown.md
```

如果没有设置 `CODEX_HOME`，使用用户默认的 `.codex` 目录。Linux、macOS 或 WSL 可以执行：

```bash
skill_root="${CODEX_HOME:-$HOME/.codex}/skills"
mkdir -p "$skill_root"
curl -fL https://docs.mymyjd.com/docskit-doc-writing.zip -o /tmp/docskit-doc-writing.zip
unzip -o /tmp/docskit-doc-writing.zip -d "$skill_root"
```

Windows PowerShell 可以执行：

```powershell
$codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$archive = Join-Path $env:TEMP "docskit-doc-writing.zip"
Invoke-WebRequest "https://docs.mymyjd.com/docskit-doc-writing.zip" -OutFile $archive
Expand-Archive $archive -DestinationPath (Join-Path $codexRoot "skills") -Force
```

安装后重新打开 Codex，或刷新 skill 列表。调用时明确提出“编写适合 DocsKit 的文档”，也可以显式使用 `$docskit-doc-writing`。
