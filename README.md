<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw Bastille" width="400">
</p>

<p align="center">
  <strong>NanoClaw Bastille</strong> — A hardened Discord fork of <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> by <a href="https://github.com/gavrielc">gavrielc</a>.
</p>

<p align="center">
  Gemini-powered AI agents running in sandboxed Docker containers. Cap-dropped, read-only, locked down.
</p>

---

## Attribution

This project is a fork of [NanoClaw](https://github.com/gavrielc/nanoclaw) by [@gavrielc](https://github.com/gavrielc). NanoClaw is an excellent piece of work — a clean, minimal, security-first AI assistant framework that prioritizes understanding over abstraction. The original philosophy of "small enough to understand, secure by isolation" is what made it worth building on top of rather than starting from scratch.

Everything good about the architecture — the container isolation model, the filesystem-based IPC, the per-group memory system, the skill-based extensibility — that's all gavrielc's design. This fork just adapts it for a different provider, a different chat platform, and a more paranoid security posture.

If you're looking for the original WhatsApp + Claude version, go to the [upstream repo](https://github.com/gavrielc/nanoclaw). It's the real thing. This is just one person's hardened variant.

## What Changed From Upstream

| Area | Upstream NanoClaw | Bastille |
|------|------------------|----------|
| **AI Provider** | Claude Agent SDK (Anthropic) | Google Gemini (`@google/genai`, gemini-3-flash-preview) |
| **Chat Platform** | WhatsApp (baileys) | Discord (discord.js v14) |
| **Container Runtime** | Apple Container / Docker | Docker |
| **Search** | Claude built-in | Google Search via separate Gemini API call |
| **Identity Files** | `CLAUDE.md` | `GEMINI.md` |
| **Security** | Container isolation | Container isolation + cap-drop, read-only root, memory limits, credential isolation |
| **Service Management** | Manual | launchd (macOS) with auto-restart |
| **Multi-Instance** | Single instance | 5 independent instances with isolated databases |

## Architecture

```
Discord (discord.js) --> SQLite --> Polling loop --> Docker Container (Gemini agent-runner) --> Response
```

Single Node.js process per instance. Agents execute in hardened Docker containers with:
- `--cap-drop=ALL` — no Linux capabilities
- `--read-only` — immutable root filesystem
- `--memory=512m --cpus=1` — resource limits
- `--security-opt=no-new-privileges` — no privilege escalation
- `--tmpfs /tmp` — ephemeral temp only
- Runtime env injection via `-e` flags (secrets never written to disk)
- `safeEnv` filtering strips API keys from all child processes (bash, grep, curl)

## Key Files

- `src/index.ts` — Main app: Discord connection, message routing, IPC
- `src/container-runner.ts` — Spawns hardened Docker containers
- `src/task-scheduler.ts` — Runs scheduled tasks
- `src/db.ts` — SQLite operations
- `container/agent-runner/src/index.ts` — Gemini function calling loop with thought signatures
- `container/agent-runner/src/tools.ts` — Agent tool implementations
- `container/agent-runner/src/ipc.ts` — File-based IPC with host process
- `groups/*/GEMINI.md` — Per-group agent identity and memory

## Tools Available to Agents

| Tool | Description |
|------|-------------|
| `bash` | Run shell commands (env-filtered) |
| `read_file` | Read files with optional line range |
| `write_file` | Create or overwrite files |
| `edit_file` | Exact string replacement |
| `list_files` | Glob pattern search |
| `search_files` | Grep through contents |
| `google_search` | Web search via Google (grounded) |
| `web_fetch` | Fetch URL content |
| `send_message` | Send Discord message mid-run |
| `schedule_task` | Create recurring/one-time tasks |
| `list_tasks` / `pause_task` / `resume_task` / `cancel_task` | Task management |

## Requirements

- macOS (launchd) or Linux (systemd — adapt plists)
- Node.js 20+
- Docker
- A Gemini API key
- A Discord bot token

## Setup

This is a personal fork — there's no guided setup skill. Clone it, create your `.env` files, register your Discord channels in SQLite, and go.

## License

MIT — Same as upstream.

## Thanks

To [@gavrielc](https://github.com/gavrielc) for building NanoClaw. The "small enough to understand" philosophy is rare and valuable. This fork exists because the original was good enough to be worth customizing rather than replacing.
