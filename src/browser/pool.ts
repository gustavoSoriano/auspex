import { chromium, type Browser, type LaunchOptions } from "playwright";

export interface BrowserPoolOptions {
  /** Maximum number of browser instances. Default: 3 */
  maxSize?: number;
  /** Playwright launch options applied to all browsers */
  launchOptions?: LaunchOptions;
  /** Timeout in ms to wait for an available browser. Default: 30000 */
  acquireTimeoutMs?: number;
}

interface Waiter {
  resolve: (browser: Browser) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrowserPool {
  private readonly maxSize: number;
  private readonly launchOptions: LaunchOptions;
  private readonly acquireTimeoutMs: number;
  private readonly browsers: Browser[] = [];
  private readonly available: Browser[] = [];
  private readonly waitQueue: Waiter[] = [];
  private closed = false;

  constructor(options: BrowserPoolOptions = {}) {
    this.maxSize = options.maxSize ?? 3;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 30_000;
    this.launchOptions = options.launchOptions ?? {
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    };
  }

  /** Acquire a browser instance. Blocks if all are in use and pool is at max capacity. */
  async acquire(): Promise<Browser> {
    if (this.closed) throw new Error("BrowserPool is closed");

    // 1. Reuse an available (idle) browser
    while (this.available.length > 0) {
      const browser = this.available.pop()!;
      if (browser.isConnected()) return browser;
      // Browser died — remove from tracking
      const idx = this.browsers.indexOf(browser);
      if (idx >= 0) this.browsers.splice(idx, 1);
    }

    // 2. Launch a new one if under capacity
    if (this.browsers.length < this.maxSize) {
      const browser = await chromium.launch(this.launchOptions);
      this.browsers.push(browser);

      // Auto-remove from pool if browser crashes
      browser.on("disconnected", () => {
        const idx = this.browsers.indexOf(browser);
        if (idx >= 0) this.browsers.splice(idx, 1);
        const availIdx = this.available.indexOf(browser);
        if (availIdx >= 0) this.available.splice(availIdx, 1);
      });

      return browser;
    }

    // 3. All browsers busy — wait in queue with timeout
    return new Promise<Browser>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
        reject(new Error(`BrowserPool acquire timeout after ${this.acquireTimeoutMs}ms`));
      }, this.acquireTimeoutMs);

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  /** Release a browser back to the pool. */
  release(browser: Browser): void {
    if (this.closed) {
      browser.close().catch(() => {});
      return;
    }

    if (!browser.isConnected()) {
      const idx = this.browsers.indexOf(browser);
      if (idx >= 0) this.browsers.splice(idx, 1);
      return;
    }

    // If someone is waiting, give it directly
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(browser);
      return;
    }

    this.available.push(browser);
  }

  /** Close all browsers and reject any waiters. */
  async close(): Promise<void> {
    this.closed = true;

    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("BrowserPool is closing"));
    }
    this.waitQueue.length = 0;

    await Promise.allSettled(this.browsers.map((b) => b.close()));
    this.browsers.length = 0;
    this.available.length = 0;
  }

  /** Current pool statistics. */
  get stats(): { total: number; available: number; waiting: number; maxSize: number } {
    return {
      total: this.browsers.length,
      available: this.available.length,
      waiting: this.waitQueue.length,
      maxSize: this.maxSize,
    };
  }
}
