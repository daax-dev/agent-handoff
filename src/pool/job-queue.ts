const queue: string[] = []; // Job IDs in FIFO order

export function enqueue(jobId: string): void {
  queue.push(jobId);
}

export function dequeue(): string | undefined {
  return queue.shift();
}

export function dequeueByPredicate(predicate: (jobId: string) => boolean): string | undefined {
  const idx = queue.findIndex(predicate);
  if (idx === -1) return undefined;
  const [jobId] = queue.splice(idx, 1);
  return jobId;
}

export function peek(): string | undefined {
  return queue[0];
}

export function size(): number {
  return queue.length;
}

export function removeFromQueue(jobId: string): boolean {
  const idx = queue.indexOf(jobId);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  return true;
}
