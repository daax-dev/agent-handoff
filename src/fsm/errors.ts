export class InvalidTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Invalid transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class CircuitBreakerError extends Error {
  readonly changeSetId: string;
  readonly cycles: number;

  constructor(changeSetId: string, cycles: number) {
    super(
      `Circuit breaker tripped for ChangeSet ${changeSetId} after ${cycles} review cycles`
    );
    this.name = "CircuitBreakerError";
    this.changeSetId = changeSetId;
    this.cycles = cycles;
  }
}
