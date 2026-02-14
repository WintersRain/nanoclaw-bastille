/**
 * NanoClaw Agent Runner (Gemini)
 * Runs inside a container, receives config via stdin, outputs result to stdout.
 * Uses Google Gemini with function calling for tool use.
 */
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import * as tools from './tools.js';
import * as ipc from './ipc.js';

// ─── Types ───────────────────────────────────────────────────────────

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  channelId: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  images?: Array<{ name: string; mimeType: string; data: string }>;
}

interface AgentResponse {
  outputType: 'message' | 'log';
  userMessage?: string;
  internalLog?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: AgentResponse | null;
  newSessionId?: string;
  error?: string;
}

// Content types matching Gemini API structure
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

// Using 'any' for parts to preserve all fields from Gemini API responses
// (including thoughtSignature required by Gemini 3 for function calling)
type GeminiPart = Record<string, unknown>;

interface SessionData {
  history: GeminiContent[];
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const MAX_TURNS = 30; // Safety limit on agentic loop
const SESSIONS_DIR = '/workspace/group/.sessions';

// ─── Function Declarations for Gemini ────────────────────────────────

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: 'bash',
    description:
      'Execute a bash command in the container. Use for running scripts, git, system commands. Working directory is /workspace/group.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: 'The bash command to execute' },
        timeout_ms: {
          type: Type.NUMBER,
          description: 'Optional timeout in milliseconds (default 120000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read a file from the filesystem. Paths are relative to /workspace/group or absolute. Returns numbered lines.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'File path to read' },
        offset: { type: Type.NUMBER, description: 'Start line (1-indexed)' },
        limit: { type: Type.NUMBER, description: 'Number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if needed.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'File path to write' },
        content: { type: Type.STRING, description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Edit a file by replacing an exact string match. The old_string must appear exactly once in the file.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'File path to edit' },
        old_string: { type: Type.STRING, description: 'Exact text to find' },
        new_string: { type: Type.STRING, description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_files',
    description: 'List files matching a glob pattern (e.g., "**/*.md", "memory/*.json").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: { type: Type.STRING, description: 'Glob pattern' },
        directory: { type: Type.STRING, description: 'Directory to search in (relative)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'search_files',
    description: 'Search file contents for a regex pattern. Returns matching lines with line numbers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: { type: Type.STRING, description: 'Regex pattern to search for' },
        path: { type: Type.STRING, description: 'File or directory to search' },
        context_lines: { type: Type.NUMBER, description: 'Lines of context around matches' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'google_search',
    description:
      'Search the web using Google Search. Returns grounded, up-to-date results. Use this for current events, facts, lookups, or anything that needs real-time web data.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns raw text/HTML.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'send_message',
    description:
      'Send a message to the chat immediately while you are still running. You can call this multiple times.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: 'Message text to send' },
      },
      required: ['text'],
    },
  },
  {
    name: 'schedule_task',
    description:
      'Schedule a recurring or one-time task. schedule_type: "cron" (e.g., "0 9 * * *"), "interval" (milliseconds), or "once" (ISO timestamp, no Z suffix). context_mode: "group" (with chat history) or "isolated" (fresh session).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: 'What the agent should do when the task runs' },
        schedule_type: { type: Type.STRING, description: 'cron | interval | once' },
        schedule_value: { type: Type.STRING, description: 'Schedule expression' },
        context_mode: { type: Type.STRING, description: 'group | isolated' },
      },
      required: ['prompt', 'schedule_type', 'schedule_value'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all scheduled tasks.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'pause_task',
    description: 'Pause a scheduled task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_id: { type: Type.STRING, description: 'Task ID to pause' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'resume_task',
    description: 'Resume a paused task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_id: { type: Type.STRING, description: 'Task ID to resume' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel and delete a scheduled task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_id: { type: Type.STRING, description: 'Task ID to cancel' },
      },
      required: ['task_id'],
    },
  },
];

// ─── Tool Execution ──────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>, ipcCtx: ipc.IpcContext): Promise<string> {
  switch (name) {
    case 'bash':
      return tools.bash(args.command as string, args.timeout_ms as number | undefined);
    case 'read_file':
      return tools.readFile(args.path as string, args.offset as number | undefined, args.limit as number | undefined);
    case 'write_file':
      return tools.writeFile(args.path as string, args.content as string);
    case 'edit_file':
      return tools.editFile(args.path as string, args.old_string as string, args.new_string as string);
    case 'list_files':
      return tools.listFiles(args.pattern as string, args.directory as string | undefined);
    case 'search_files':
      return tools.searchFiles(args.pattern as string, args.path as string | undefined, args.context_lines as number | undefined);
    case 'google_search':
      return await tools.googleSearch(args.query as string);
    case 'web_fetch':
      return tools.webFetch(args.url as string);
    case 'send_message':
      return ipc.sendMessage(ipcCtx, args.text as string);
    case 'schedule_task':
      return ipc.scheduleTask(
        ipcCtx,
        args.prompt as string,
        args.schedule_type as string,
        args.schedule_value as string,
        (args.context_mode as string) || 'group',
        args.target_channel_id as string | undefined,
      );
    case 'list_tasks':
      return ipc.listTasks(ipcCtx);
    case 'pause_task':
      return ipc.taskAction(ipcCtx, 'pause_task', args.task_id as string);
    case 'resume_task':
      return ipc.taskAction(ipcCtx, 'resume_task', args.task_id as string);
    case 'cancel_task':
      return ipc.taskAction(ipcCtx, 'cancel_task', args.task_id as string);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Session Management ──────────────────────────────────────────────

function loadSession(sessionId: string): GeminiContent[] | null {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const data: SessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    return data.history;
  } catch {
    return null;
  }
}

function saveSession(sessionId: string, history: GeminiContent[]): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const data: SessionData = { history, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), JSON.stringify(data));
}

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Conversation Archive ────────────────────────────────────────────

function archiveConversation(history: GeminiContent[]): void {
  const conversationsDir = '/workspace/group/conversations';
  fs.mkdirSync(conversationsDir, { recursive: true });

  const lines: string[] = [];
  const date = new Date().toISOString().split('T')[0];

  for (const msg of history) {
    const role = msg.role === 'user' ? 'User' : 'Agent';
    const text = msg.parts
      ?.filter((p): p is { text: string } => 'text' in p && typeof (p as { text?: string }).text === 'string')
      .map((p) => p.text)
      .join('');
    if (text) {
      const trimmed = text.length > 2000 ? text.slice(0, 2000) + '...' : text;
      lines.push(`**${role}**: ${trimmed}\n`);
    }
  }

  if (lines.length > 0) {
    const time = new Date().toTimeString().slice(0, 5).replace(':', '');
    const filename = `${date}-conversation-${time}.md`;
    fs.writeFileSync(path.join(conversationsDir, filename), `# Conversation\n\n${lines.join('\n')}`);
  }
}

// ─── I/O ─────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

// ─── System Prompt Builder ───────────────────────────────────────────

function buildSystemPrompt(input: ContainerInput): string {
  const parts: string[] = [];

  // Load GEMINI.md (identity file)
  const identityPath = '/workspace/group/GEMINI.md';
  if (fs.existsSync(identityPath)) {
    parts.push(fs.readFileSync(identityPath, 'utf-8'));
  }

  // Load global GEMINI.md
  const globalPath = '/workspace/global/GEMINI.md';
  if (!input.isMain && fs.existsSync(globalPath)) {
    parts.push('\n---\n## Global Context\n' + fs.readFileSync(globalPath, 'utf-8'));
  }

  // Response format instruction
  parts.push(`
---
## Response Format

When you are done working, output your final response as plain text. This text will be sent directly to the Discord chat.
- Write naturally as yourself.
- Do NOT wrap your response in JSON or code blocks.
- You were specifically addressed or mentioned — always respond with something.`);

  return parts.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    const stdinData = await readStdin();
    input = JSON.parse(stdinData);
    log(`Received input for group: ${input.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    writeOutput({ status: 'error', result: null, error: 'GEMINI_API_KEY not set' });
    process.exit(1);
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const ai = new GoogleGenAI({ apiKey });

  const ipcCtx: ipc.IpcContext = {
    channelId: input.channelId,
    groupFolder: input.groupFolder,
    isMain: input.isMain,
  };

  const systemPrompt = buildSystemPrompt(input);

  // Gemini tools: function declarations for agent capabilities
  // Note: googleSearch cannot be combined with functionDeclarations in the same request
  const geminiTools = [
    { functionDeclarations },
  ];

  // Load or start session
  let contents: GeminiContent[] = [];
  const sessionId = input.sessionId || generateSessionId();

  if (input.sessionId) {
    const loaded = loadSession(input.sessionId);
    if (loaded) {
      contents = loaded;
      log(`Resumed session: ${input.sessionId} (${loaded.length} entries)`);
    }
  }

  // Build user prompt
  let prompt = input.prompt;
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }

  // Add user message to contents
  // Build user message parts (text + optional images for multimodal)
  const userParts: GeminiPart[] = [{ text: prompt }];
  if (input.images && input.images.length > 0) {
    for (const img of input.images) {
      userParts.push({
        inlineData: { mimeType: img.mimeType, data: img.data },
      });
      log(`Image attached to prompt: ${img.name} (${img.mimeType})`);
    }
  }
  contents.push({ role: 'user', parts: userParts });

  let result: AgentResponse | null = null;
  let turns = 0;

  try {
    log('Starting agent...');

    while (turns < MAX_TURNS) {
      turns++;

      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction: systemPrompt,
          tools: geminiTools,
        },
      });

      // Check for function calls
      if (response.functionCalls && response.functionCalls.length > 0) {
        // Preserve raw model parts (includes thoughtSignature required by Gemini 3)
        const rawParts = response.candidates?.[0]?.content?.parts;
        if (rawParts) {
          contents.push({ role: 'model', parts: rawParts as GeminiPart[] });
        } else {
          // Fallback: reconstruct from convenience property
          contents.push({
            role: 'model',
            parts: response.functionCalls.map((fc) => ({
              functionCall: { name: fc.name!, args: (fc.args ?? {}) as Record<string, unknown> },
            })),
          });
        }

        // Execute all function calls
        const functionResponses: GeminiPart[] = [];
        for (const fc of response.functionCalls) {
          const name = fc.name!;
          log(`Tool call: ${name}`);
          const toolResult = await executeTool(name, (fc.args ?? {}) as Record<string, unknown>, ipcCtx);
          functionResponses.push({
            functionResponse: {
              name,
              response: { result: toolResult },
            },
          });
        }

        // Add function responses to history
        contents.push({ role: 'user', parts: functionResponses });
      } else {
        // Text response — final answer
        const text = (response.text || '').trim();

        // Add model's text response to history
        contents.push({ role: 'model', parts: [{ text }] });

        // Strip any stray markers the model might include
        const cleaned = text.replace(/\[SILENT\]/gi, '').trim();
        if (!cleaned) {
          result = { outputType: 'log', internalLog: 'Agent returned empty response' };
        } else {
          result = { outputType: 'message', userMessage: cleaned };
        }
        break;
      }
    }

    if (turns >= MAX_TURNS) {
      log(`Hit max turns (${MAX_TURNS})`);
    }

    // Save session
    saveSession(sessionId, contents);

    // Archive conversation
    try {
      archiveConversation(contents);
    } catch (err) {
      log(`Archive failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Validate result
    if (result?.outputType === 'message' && !result.userMessage) {
      log('Warning: outputType is "message" but userMessage is missing');
      result = { outputType: 'log', internalLog: result.internalLog };
    }

    log(`Agent completed: outputType=${result?.outputType ?? 'none'} turns=${turns}`);

    writeOutput({
      status: 'success',
      result: result ?? { outputType: 'log' },
      newSessionId: sessionId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({ status: 'error', result: null, newSessionId: sessionId, error: errorMessage });
    process.exit(1);
  }
}

main();
