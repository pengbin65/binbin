export type TaskStatus =
  | "idle"
  | "connecting"
  | "starting_profile"
  | "logging_in"
  | "navigating"
  | "pricing"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type LogEntry = {
  at: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
};

export type ResultRow = {
  productId: string;
  quotedPrice: number;
  originalPrice: number;
  threshold70Percent: number;
  currentSellingPrice: number;
  officialSuggestedPrice: number;
  passed: boolean;
  action: "recorded" | "rejected" | "skipped";
  reason: string;
  error?: string;
};

export type TaskSnapshot = {
  status: TaskStatus;
  pauseRequested: boolean;
  stopRequested: boolean;
  logs: LogEntry[];
  results: ResultRow[];
};

export class TaskStateStore {
  private status: TaskStatus = "idle";
  private pauseRequested = false;
  private stopRequested = false;
  private logs: LogEntry[] = [];
  private results: ResultRow[] = [];

  start(): void {
    this.status = "connecting";
    this.pauseRequested = false;
    this.stopRequested = false;
    this.logs = [];
    this.results = [];
  }

  setStatus(status: TaskStatus): void {
    if (this.stopRequested) {
      this.status = "stopped";
      return;
    }
    this.status = status;
  }

  log(phase: string, message: string, level: LogEntry["level"] = "info"): void {
    this.logs.push({ at: new Date().toISOString(), level, phase, message });
  }

  recordResult(row: ResultRow): void {
    this.results.push({ ...row });
  }

  requestPause(): void {
    this.pauseRequested = true;
  }

  markPaused(): void {
    if (this.stopRequested) {
      this.status = "stopped";
      return;
    }
    this.status = "paused";
  }

  requestStop(): void {
    this.stopRequested = true;
    this.status = "stopped";
  }

  shouldPause(): boolean {
    return this.pauseRequested;
  }

  shouldStop(): boolean {
    return this.stopRequested;
  }

  snapshot(): TaskSnapshot {
    return {
      status: this.status,
      pauseRequested: this.pauseRequested,
      stopRequested: this.stopRequested,
      logs: this.logs.map((log) => ({ ...log })),
      results: this.results.map((result) => ({ ...result }))
    };
  }
}
