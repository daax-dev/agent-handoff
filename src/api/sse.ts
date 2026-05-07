import { watch, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { FSWatcher } from "node:fs";

export interface SSEEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: string;
}

function encodeEvent(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export class SSEBroadcaster {
  private subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private logWatchers = new Map<string, FSWatcher>();
  private encoder = new TextEncoder();

  subscribe(): ReadableStream<Uint8Array> {
    const broadcaster = this;
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrl = controller;
        broadcaster.subscribers.add(controller);
        // Send keep-alive comment immediately
        try {
          controller.enqueue(broadcaster.encoder.encode(": connected\n\n"));
        } catch {}
      },
      cancel() {
        broadcaster.subscribers.delete(ctrl);
      },
    });

    return stream;
  }

  emit(event: SSEEvent): void {
    const chunk = this.encoder.encode(encodeEvent(event));
    const dead = new Set<ReadableStreamDefaultController<Uint8Array>>();

    for (const ctrl of this.subscribers) {
      try {
        ctrl.enqueue(chunk);
      } catch {
        dead.add(ctrl);
      }
    }

    for (const ctrl of dead) {
      this.subscribers.delete(ctrl);
    }
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  watchLog(taskId: string, repoRoot?: string): void {
    if (this.logWatchers.has(taskId)) return;

    const logsDir = resolve(repoRoot ?? process.cwd(), ".work", "logs");
    mkdirSync(logsDir, { recursive: true });
    const logPath = resolve(logsDir, `${taskId}.log`);

    let offset = 0;

    const flush = () => {
      if (!existsSync(logPath)) return;
      const file = Bun.file(logPath);
      file.text().then((content) => {
        if (content.length <= offset) return;
        const newContent = content.slice(offset);
        offset = content.length;
        for (const line of newContent.split("\n")) {
          if (line.trim()) {
            this.emit({
              type: "agent_output",
              payload: { taskId, line, ts: new Date().toISOString() },
              ts: new Date().toISOString(),
            });
          }
        }
      });
    };

    const watcher = watch(dirname(logPath), (event, filename) => {
      if (filename === `${taskId}.log`) flush();
    });

    this.logWatchers.set(taskId, watcher);
  }

  stopWatchLog(taskId: string): void {
    const watcher = this.logWatchers.get(taskId);
    if (watcher) {
      watcher.close();
      this.logWatchers.delete(taskId);
    }
  }

  close(): void {
    for (const [, watcher] of this.logWatchers) {
      watcher.close();
    }
    this.logWatchers.clear();
    this.subscribers.clear();
  }
}

export const broadcaster = new SSEBroadcaster();
