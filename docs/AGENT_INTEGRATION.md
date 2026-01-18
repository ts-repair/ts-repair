# Agent Integration

ts-repair integrates with AI coding assistants via the Model Context Protocol (MCP). This document describes how to set up ts-repair with various agent platforms.

## Overview

ts-repair exposes three MCP tools:

| Tool | Description |
|------|-------------|
| `ts_repair_plan` | Generate a verified TypeScript repair plan |
| `ts_repair_apply` | Apply verified repairs to files |
| `ts_repair_check` | Quick check for TypeScript error count |

## MCP Server

Start the MCP server with:

```bash
ts-repair mcp-server
```

The server communicates over stdio using JSON-RPC (Model Context Protocol).

## Platform-Specific Setup

### Claude Code

**Option 1: MCP Server (Recommended)**

Add to `~/.claude/settings.json`:

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

**Option 2: Agent Skill**

Copy the skill to your skills directory:

```bash
mkdir -p ~/.claude/skills
cp -r skills/claude-code/ts-repair ~/.claude/skills/
```

### OpenCode

Add to your `opencode.json`:

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

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.ts-repair]
command = "npx"
args = ["ts-repair", "mcp-server"]
startup_timeout_sec = 30
tool_timeout_sec = 120
enabled = true
```

## MCP Tool Reference

### ts_repair_plan

Generate a verified TypeScript repair plan.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tsconfig` | string | `./tsconfig.json` | Path to tsconfig.json |
| `maxVerifications` | number | 500 | Maximum verification budget |
| `includeHighRisk` | boolean | false | Include high-risk fixes |

**Example Response:**

```json
{
  "steps": [
    {
      "id": "fix-0",
      "diagnostic": {
        "code": 2304,
        "message": "Cannot find name 'foo'.",
        "file": "/path/to/file.ts",
        "line": 10,
        "column": 5
      },
      "fixName": "import",
      "fixDescription": "Add import from \"./foo\"",
      "changes": [...],
      "risk": "low",
      "delta": 1
    }
  ],
  "remaining": [...],
  "summary": {
    "initialErrors": 5,
    "finalErrors": 2,
    "fixedCount": 3
  }
}
```

### ts_repair_apply

Apply verified TypeScript repairs to files.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tsconfig` | string | `./tsconfig.json` | Path to tsconfig.json |
| `filter` | `"all"` \| `"low-risk"` | `"low-risk"` | Which fixes to apply |

**Example Response:**

```
Applied 3 fixes. 2 diagnostics remain.

Applied: fix-0, fix-1, fix-2
```

### ts_repair_check

Quick check for TypeScript error count.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tsconfig` | string | `./tsconfig.json` | Path to tsconfig.json |

**Example Response:**

```json
{
  "errorCount": 5
}
```

## Agent Behavior

When properly configured, agents will use ts-repair when:

1. TypeScript compilation errors are encountered
2. The user asks to "fix TypeScript errors" or "fix types"
3. Running `tsc` shows errors

### Recommended Workflow

1. **Quick check**: Use `ts_repair_check` to see error count
2. **Get plan**: Use `ts_repair_plan` to get verified fixes
3. **Review fixes**: Examine the `steps` array - all fixes are verified
4. **Apply fixes**: Use `ts_repair_apply` for automatic application
5. **Handle remaining**: For `remaining` diagnostics:
   - `AutoFixable`: Apply with `--apply --include-high-risk`
   - `NeedsJudgment`: Present options to user
   - `NoCandidate`: Investigate manually

### Diagnostic Dispositions

| Disposition | Meaning | Agent Action |
|-------------|---------|--------------|
| `AutoFixable` | Verified fix exists, low risk | Apply automatically |
| `AutoFixableHighRisk` | Verified fix exists, semantic risk | Ask user before applying |
| `NeedsJudgment` | Multiple valid fixes | Present options to user |
| `NoGeneratedCandidate` | No TypeScript fix available | Manual investigation needed |
| `NoVerifiedCandidate` | Fixes exist but none reduce errors | Root cause investigation needed |

## Troubleshooting

### MCP Server Not Starting

1. Ensure ts-repair is installed: `npm install -g ts-repair`
2. Test manually: `ts-repair mcp-server`
3. Check the agent's MCP server logs

### No Fixes Found

1. Check if the project has a valid `tsconfig.json`
2. Try running `ts-repair check -p ./tsconfig.json` directly
3. Some errors may have no TypeScript-suggested fixes

### Fixes Not Working

1. Verify the tsconfig path is correct (relative to working directory)
2. Check file permissions
3. Look for `NoVerifiedCandidate` disposition - may indicate deeper issues

## Fallback

If ts-repair is unavailable, agents should fall back to:

```bash
tsc --noEmit
```

And fix errors manually based on raw TypeScript diagnostics.
