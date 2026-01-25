# ts-repair Agent Skills

This directory contains agent skills for integrating ts-repair with AI coding assistants.

## Supported Platforms

| Platform | Skill Location | Description |
|----------|----------------|-------------|
| **Claude Code** | `claude-code/ts-repair/` | Skill for Anthropic's Claude Code CLI |
| **Claude Code** | `claude-code/ts-expert-repair/` | Expert skill for developing and testing complex error repairs |
| **OpenCode** | `opencode/ts-repair/` | Skill for OpenCode |
| **Codex CLI** | `codex/ts-repair/` | Skill for OpenAI's Codex CLI |

## Installation

### Prerequisites

ts-repair must be installed globally or available via npx:

```bash
# Global installation
npm install -g ts-repair

# Or use directly with npx
npx ts-repair repair ./tsconfig.json
```

### Claude Code

Copy the skill to your Claude Code skills directory:

```bash
# Create the skills directory if it doesn't exist
mkdir -p ~/.claude/skills

# Copy the ts-repair skill
cp -r skills/claude-code/ts-repair ~/.claude/skills/
```

Or configure ts-repair as an MCP server in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "ts-repair": {
      "command": "npx",
      "args": ["ts-repair", "mcp-server"]
    }
  }
}
```

### OpenCode

Configure ts-repair as an MCP server in `opencode.json`:

```json
{
  "mcp": {
    "ts-repair": {
      "type": "local",
      "command": ["npx", "ts-repair", "mcp-server"],
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

Or copy the skill to your OpenCode skills directory.

### Codex CLI

Configure ts-repair as an MCP server in `~/.codex/config.toml`:

```toml
[mcp_servers.ts-repair]
command = "npx"
args = ["ts-repair", "mcp-server"]
startup_timeout_sec = 30
tool_timeout_sec = 120
enabled = true
```

Or copy the skill to your Codex skills directory.

## MCP Tools

When using ts-repair via MCP, the following tools are available:

| Tool | Description |
|------|-------------|
| `ts_repair_plan` | Generate a verified TypeScript repair plan |
| `ts_repair_apply` | Apply verified repairs to files |
| `ts_repair_check` | Quick check for TypeScript error count |

## Usage

Once configured, the AI assistant will automatically use ts-repair when:

- TypeScript compilation errors are encountered
- The user asks to "fix TypeScript errors" or "fix types"
- Running `tsc` shows errors

The skill teaches the agent to:
1. Use `ts-repair check` for quick error counts
2. Use `ts-repair repair --json` for verified repair plans
3. Apply AutoFixable fixes directly
4. Present NeedsJudgment fixes for user decision
5. Investigate NoCandidate diagnostics manually

## Fallback

If ts-repair is not available or fails, the agents fall back to:
```bash
tsc --noEmit
```
And fix errors manually based on raw diagnostics.
