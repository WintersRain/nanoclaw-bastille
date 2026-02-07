import { ChildProcess, exec } from 'child_process';

import { MAX_CONCURRENT_CONTAINERS } from './config.js';
import { logger } from './logger.js';

interface QueuedTask {
  id: string;
  channelId: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface GroupState {
  active: boolean;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  retryCount: number;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((channelId: string) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;

  private getGroup(channelId: string): GroupState {
    let state = this.groups.get(channelId);
    if (!state) {
      state = {
        active: false,
        pendingMessages: false,
        pendingTasks: [],
        process: null,
        containerName: null,
        retryCount: 0,
      };
      this.groups.set(channelId, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (channelId: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(channelId: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(channelId);

    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ channelId }, 'Container active, message queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingMessages = true;
      if (!this.waitingGroups.includes(channelId)) {
        this.waitingGroups.push(channelId);
      }
      logger.debug(
        { channelId, activeCount: this.activeCount },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(channelId, 'messages');
  }

  enqueueTask(channelId: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(channelId);

    // Prevent double-queuing of the same task
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ channelId, taskId }, 'Task already queued, skipping');
      return;
    }

    if (state.active) {
      state.pendingTasks.push({ id: taskId, channelId, fn });
      logger.debug({ channelId, taskId }, 'Container active, task queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingTasks.push({ id: taskId, channelId, fn });
      if (!this.waitingGroups.includes(channelId)) {
        this.waitingGroups.push(channelId);
      }
      logger.debug(
        { channelId, taskId, activeCount: this.activeCount },
        'At concurrency limit, task queued',
      );
      return;
    }

    // Run immediately
    this.runTask(channelId, { id: taskId, channelId, fn });
  }

  registerProcess(channelId: string, proc: ChildProcess, containerName: string): void {
    const state = this.getGroup(channelId);
    state.process = proc;
    state.containerName = containerName;
  }

  private async runForGroup(
    channelId: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(channelId);
    state.active = true;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug(
      { channelId, reason, activeCount: this.activeCount },
      'Starting container for group',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(channelId);
        if (success) {
          state.retryCount = 0;
        } else {
          this.scheduleRetry(channelId, state);
        }
      }
    } catch (err) {
      logger.error({ channelId, err }, 'Error processing messages for group');
      this.scheduleRetry(channelId, state);
    } finally {
      state.active = false;
      state.process = null;
      state.containerName = null;
      this.activeCount--;
      this.drainGroup(channelId);
    }
  }

  private async runTask(channelId: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(channelId);
    state.active = true;
    this.activeCount++;

    logger.debug(
      { channelId, taskId: task.id, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ channelId, taskId: task.id, err }, 'Error running task');
    } finally {
      state.active = false;
      state.process = null;
      state.containerName = null;
      this.activeCount--;
      this.drainGroup(channelId);
    }
  }

  private scheduleRetry(channelId: string, state: GroupState): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { channelId, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { channelId, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(channelId);
      }
    }, delayMs);
  }

  private drainGroup(channelId: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(channelId);

    // Tasks first (they won't be re-discovered from SQLite like messages)
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(channelId, task);
      return;
    }

    // Then pending messages
    if (state.pendingMessages) {
      this.runForGroup(channelId, 'drain');
      return;
    }

    // Nothing pending for this group; check if other groups are waiting for a slot
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (
      this.waitingGroups.length > 0 &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS
    ) {
      const nextChannelId = this.waitingGroups.shift()!;
      const state = this.getGroup(nextChannelId);

      // Prioritize tasks over messages
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(nextChannelId, task);
      } else if (state.pendingMessages) {
        this.runForGroup(nextChannelId, 'drain');
      }
      // If neither pending, skip this group
    }
  }

  async shutdown(gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;
    logger.info(
      { activeCount: this.activeCount, gracePeriodMs },
      'GroupQueue shutting down',
    );

    // Collect all active processes
    const activeProcs: Array<{ channelId: string; proc: ChildProcess; containerName: string | null }> = [];
    for (const [channelId, state] of this.groups) {
      if (state.process && !state.process.killed) {
        activeProcs.push({ channelId, proc: state.process, containerName: state.containerName });
      }
    }

    if (activeProcs.length === 0) return;

    // Stop all active containers gracefully
    for (const { channelId, proc, containerName } of activeProcs) {
      if (containerName) {
        // Defense-in-depth: re-sanitize before shell interpolation.
        // Primary sanitization is in container-runner.ts when building the name,
        // but we sanitize again here since exec() runs through a shell.
        const safeName = containerName.replace(/[^a-zA-Z0-9-]/g, '');
        logger.info({ channelId, containerName: safeName }, 'Stopping container');
        exec(`container stop ${safeName}`, (err) => {
          if (err) {
            logger.warn({ channelId, containerName: safeName, err: err.message }, 'container stop failed');
          }
        });
      } else {
        logger.info({ channelId, pid: proc.pid }, 'Sending SIGTERM to process');
        proc.kill('SIGTERM');
      }
    }

    // Wait for grace period
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const alive = activeProcs.filter(
          ({ proc }) => !proc.killed && proc.exitCode === null,
        );
        if (alive.length === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);

      setTimeout(() => {
        clearInterval(checkInterval);
        // SIGKILL survivors
        for (const { channelId, proc } of activeProcs) {
          if (!proc.killed && proc.exitCode === null) {
            logger.warn({ channelId, pid: proc.pid }, 'Sending SIGKILL to container');
            proc.kill('SIGKILL');
          }
        }
        resolve();
      }, gracePeriodMs);
    });
  }
}
