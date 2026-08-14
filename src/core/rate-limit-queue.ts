import { RATE_LIMIT_RESERVE } from '../shared/constants';
import { errorMessage } from '../shared/errors';
import type { RateLimitInfo } from '../shared/types';
import { childLogger } from './logger';

const log = childLogger('rate-limit');

interface QueueTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  label: string;
  /** Lower runs first. */
  priority: number;
}

export interface QueueOptions {
  concurrency?: number;
  /** Minimum gap between task starts, in ms. Smooths bursts. */
  minIntervalMs?: number;
}

/**
 * Serialises GitHub API calls.
 *
 * Two things matter for a process that runs for weeks: never burn the whole
 * hourly quota in one sync, and never hammer GitHub after a secondary-limit
 * 403. So the queue keeps a small concurrency, spaces calls out, and parks
 * itself until the reset time when the remaining quota gets low.
 */
export class RateLimitQueue {
  private readonly concurrency: number;
  private readonly minIntervalMs: number;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous task results by design
  private readonly tasks: QueueTask<any>[] = [];
  private active = 0;
  private lastStartedAt = 0;
  /** Epoch ms. While in the future, no task is started. */
  private pausedUntil = 0;
  /**
   * Quotas per GitHub resource.
   *
   * These are genuinely separate budgets: `core` allows 5000 requests an hour
   * while `search` allows 30 a minute. Tracking a single number for both meant
   * one search made the queue believe it was nearly out of quota and park every
   * other request until the hourly reset.
   */
  private readonly quotas = new Map<string, { limit: number; remaining: number; resetAt: Date }>();

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.minIntervalMs = options.minIntervalMs ?? 120;
  }

  /** The core quota, which is the one worth showing a user. */
  get info(): RateLimitInfo {
    const core = this.quotas.get('core');
    return {
      limit: core?.limit ?? 5000,
      remaining: core?.remaining ?? 5000,
      resetAt: core?.resetAt.toISOString() ?? null,
      queued: this.tasks.length + this.active,
    };
  }

  /** Every tracked quota, for diagnostics. */
  get allQuotas(): Record<string, RateLimitInfo> {
    const out: Record<string, RateLimitInfo> = {};
    for (const [name, quota] of this.quotas) {
      out[name] = {
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt.toISOString(),
        queued: 0,
      };
    }
    return out;
  }

  /** Feed the queue the rate-limit headers from every GitHub response. */
  observeHeaders(headers: Record<string, string | number | undefined>): void {
    const limit = numberHeader(headers['x-ratelimit-limit']);
    const remaining = numberHeader(headers['x-ratelimit-remaining']);
    const reset = numberHeader(headers['x-ratelimit-reset']);
    const resource =
      typeof headers['x-ratelimit-resource'] === 'string'
        ? headers['x-ratelimit-resource']
        : 'core';

    if (limit === null || remaining === null || reset === null) {
      return;
    }

    const resetAt = new Date(reset * 1000);
    this.quotas.set(resource, { limit, remaining, resetAt });

    // The reserve has to scale with the budget: keeping 100 calls spare is
    // prudent out of 5000 and impossible out of 30.
    const reserve = resource === 'core' ? RATE_LIMIT_RESERVE : Math.max(2, Math.ceil(limit * 0.1));

    if (remaining < reserve) {
      const waitMs = Math.max(resetAt.getTime() - Date.now(), 0) + 1000;
      this.pauseFor(waitMs, `${resource} quota low (${remaining}/${limit} left)`);
    }
  }

  /** Back off after a 403/429. `retryAfterSeconds` comes from the header. */
  backOff(retryAfterSeconds: number | null, reason: string): void {
    const waitMs = (retryAfterSeconds ?? 60) * 1000;
    this.pauseFor(waitMs, reason);
  }

  private pauseFor(ms: number, reason: string): void {
    const until = Date.now() + ms;
    if (until <= this.pausedUntil) {
      return;
    }
    this.pausedUntil = until;
    log.warn({ waitMs: ms, reason }, 'pausing GitHub queue');
    setTimeout(() => this.drain(), ms + 50).unref?.();
  }

  /** Queue a GitHub call. Rejections propagate to the caller unchanged. */
  add<T>(label: string, run: () => Promise<T>, priority = 10): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.tasks.push({ run, resolve, reject, label, priority });
      this.tasks.sort((a, b) => a.priority - b.priority);
      this.drain();
    });
  }

  private drain(): void {
    if (this.active >= this.concurrency || this.tasks.length === 0) {
      return;
    }

    const now = Date.now();
    if (now < this.pausedUntil) {
      return;
    }

    const sinceLast = now - this.lastStartedAt;
    if (sinceLast < this.minIntervalMs) {
      setTimeout(() => this.drain(), this.minIntervalMs - sinceLast).unref?.();
      return;
    }

    const task = this.tasks.shift();
    if (!task) {
      return;
    }

    this.active += 1;
    this.lastStartedAt = Date.now();

    task
      .run()
      .then(task.resolve)
      .catch((error: unknown) => {
        log.debug({ task: task.label, err: errorMessage(error) }, 'queued GitHub call failed');
        task.reject(error);
      })
      .finally(() => {
        this.active -= 1;
        this.drain();
      });

    // Try to fill the remaining concurrency slots straight away.
    this.drain();
  }

  /** Drops every queued task. Used on shutdown and on token change. */
  clear(reason: string): void {
    const pending = this.tasks.splice(0, this.tasks.length);
    for (const task of pending) {
      task.reject(new Error(`Queue cleared: ${reason}`));
    }
  }
}

function numberHeader(value: string | number | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
