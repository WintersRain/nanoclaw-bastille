/**
 * Local tool implementations for the Gemini agent runner.
 * These run inside the container — file ops, bash, search.
 */
import fs from 'fs';
import path from 'path';
import { execSync, ExecSyncOptions } from 'child_process';
import { globSync } from 'glob';
import { GoogleGenAI } from '@google/genai';

const MAX_OUTPUT = 30000; // Truncate long outputs

// Sanitized environment for child processes — strips secrets so agent
// can't exfiltrate API keys via `env`, `printenv`, or `echo $VAR`.
const SECRETS = new Set(['GEMINI_API_KEY', 'GEMINI_MODEL']);
const safeEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (!SECRETS.has(k) && v !== undefined) safeEnv[k] = v;
}

function truncate(s: string, max = MAX_OUTPUT): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...[truncated, ${s.length - max} chars omitted]`;
}

export function bash(command: string, timeoutMs = 120000): string {
  try {
    const opts: ExecSyncOptions = {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      cwd: '/workspace/group',
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: safeEnv,
    };
    const stdout = execSync(command, opts) as string;
    return truncate(stdout || '(no output)');
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    const out = (e.stdout || '') + (e.stderr || '');
    return truncate(out || e.message || 'Command failed');
  }
}

export function readFile(filePath: string, offset?: number, limit?: number): string {
  const resolved = path.resolve('/workspace/group', filePath);
  if (!fs.existsSync(resolved)) return `Error: File not found: ${resolved}`;

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    const lines = content.split('\n');
    const start = (offset ?? 1) - 1; // 1-indexed to 0-indexed
    const end = limit ? start + limit : lines.length;
    const slice = lines.slice(Math.max(0, start), end);

    return truncate(
      slice.map((line, i) => `${String(start + i + 1).padStart(6)}  ${line}`).join('\n'),
    );
  } catch (err) {
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function writeFile(filePath: string, content: string): string {
  const resolved = path.resolve('/workspace/group', filePath);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    return `File written: ${resolved}`;
  } catch (err) {
    return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function editFile(filePath: string, oldString: string, newString: string): string {
  const resolved = path.resolve('/workspace/group', filePath);
  if (!fs.existsSync(resolved)) return `Error: File not found: ${resolved}`;

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    const count = content.split(oldString).length - 1;
    if (count === 0) return `Error: old_string not found in file.`;
    if (count > 1) return `Error: old_string found ${count} times — must be unique. Provide more context.`;

    fs.writeFileSync(resolved, content.replace(oldString, newString));
    return `File edited: ${resolved}`;
  } catch (err) {
    return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function listFiles(pattern: string, directory?: string): string {
  const cwd = directory ? path.resolve('/workspace/group', directory) : '/workspace/group';
  try {
    const matches = globSync(pattern, { cwd, nodir: false });
    if (matches.length === 0) return 'No files matched.';
    return truncate(matches.sort().join('\n'));
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function searchFiles(pattern: string, filePath?: string, contextLines?: number): string {
  const target = filePath ? path.resolve('/workspace/group', filePath) : '/workspace/group';
  const ctx = contextLines ? `-C ${contextLines}` : '';
  try {
    const result = execSync(
      `grep -rn ${ctx} --include='*' -e ${JSON.stringify(pattern)} ${JSON.stringify(target)}`,
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 5 * 1024 * 1024, env: safeEnv },
    );
    return truncate(result || 'No matches found.');
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return 'No matches found.';
    return truncate(e.stdout || 'Search failed.');
  }
}

export async function googleSearch(query: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return 'Error: GEMINI_API_KEY not available for search';
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    return truncate(response.text || '(no search results)');
  } catch (err) {
    return `Search error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function webFetch(url: string): string {
  // Use curl since fetch() may not work in all Node versions inside the container
  try {
    const result = execSync(
      `curl -sL --max-time 15 --max-filesize 5242880 -H "User-Agent: NanoClaw/2.0" ${JSON.stringify(url)}`,
      { encoding: 'utf-8', timeout: 20000, maxBuffer: 5 * 1024 * 1024, env: safeEnv },
    );
    return truncate(result || '(empty response)');
  } catch (err) {
    return `Error fetching URL: ${err instanceof Error ? err.message : String(err)}`;
  }
}
