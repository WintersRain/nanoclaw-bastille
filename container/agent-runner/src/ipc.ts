/**
 * IPC module for NanoClaw - File-based IPC with host process
 * No SDK dependency — just writes JSON files that the host picks up.
 */
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

export interface IpcContext {
  channelId: string;
  groupFolder: string;
  isMain: boolean;
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);
  return filename;
}

export function sendMessage(ctx: IpcContext, text: string): string {
  writeIpcFile(MESSAGES_DIR, {
    type: 'message',
    channelId: ctx.channelId,
    text,
    groupFolder: ctx.groupFolder,
    timestamp: new Date().toISOString(),
  });
  return 'Message sent.';
}

export function scheduleTask(
  ctx: IpcContext,
  prompt: string,
  scheduleType: string,
  scheduleValue: string,
  contextMode: string,
  targetChannelId?: string,
): string {
  // Validate
  if (scheduleType === 'cron') {
    try {
      CronExpressionParser.parse(scheduleValue);
    } catch {
      return `Invalid cron: "${scheduleValue}". Use format like "0 9 * * *" (daily 9am).`;
    }
  } else if (scheduleType === 'interval') {
    const ms = parseInt(scheduleValue, 10);
    if (isNaN(ms) || ms <= 0) {
      return `Invalid interval: "${scheduleValue}". Must be positive milliseconds.`;
    }
  } else if (scheduleType === 'once') {
    if (isNaN(new Date(scheduleValue).getTime())) {
      return `Invalid timestamp: "${scheduleValue}". Use ISO 8601 format.`;
    }
  }

  const filename = writeIpcFile(TASKS_DIR, {
    type: 'schedule_task',
    prompt,
    schedule_type: scheduleType,
    schedule_value: scheduleValue,
    context_mode: contextMode || 'group',
    targetChannelId: ctx.isMain && targetChannelId ? targetChannelId : ctx.channelId,
    createdBy: ctx.groupFolder,
    timestamp: new Date().toISOString(),
  });
  return `Task scheduled (${filename}): ${scheduleType} - ${scheduleValue}`;
}

export function listTasks(ctx: IpcContext): string {
  const tasksFile = path.join(IPC_DIR, 'current_tasks.json');
  if (!fs.existsSync(tasksFile)) return 'No scheduled tasks found.';

  try {
    const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
    const tasks = ctx.isMain
      ? allTasks
      : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === ctx.groupFolder);

    if (tasks.length === 0) return 'No scheduled tasks found.';

    return tasks
      .map(
        (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
          `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
      )
      .join('\n');
  } catch (err) {
    return `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function taskAction(ctx: IpcContext, action: string, taskId: string): string {
  writeIpcFile(TASKS_DIR, {
    type: action,
    taskId,
    groupFolder: ctx.groupFolder,
    isMain: ctx.isMain,
    timestamp: new Date().toISOString(),
  });
  return `Task ${taskId} ${action.replace('_task', '')} requested.`;
}

export function registerChannel(
  ctx: IpcContext,
  channelId: string,
  name: string,
  folder: string,
  trigger: string,
): string {
  if (!ctx.isMain) return 'Only the main channel can register new channels.';

  writeIpcFile(TASKS_DIR, {
    type: 'register_channel',
    channelId,
    name,
    folder,
    trigger,
    timestamp: new Date().toISOString(),
  });
  return `Channel "${name}" registered. It will start receiving messages immediately.`;
}
