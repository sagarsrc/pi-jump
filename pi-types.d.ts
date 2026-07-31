declare module "@earendil-works/pi-coding-agent" {
  export interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
  }

  export interface ExecOptions {
    timeout?: number;
  }

  export interface ExtensionContext {
    sessionManager: { getSessionId(): string };
    cwd: string;
    ui: {
      notify(message: string, level?: string): void;
      select(prompt: string, options: string[]): Promise<string | null>;
    };
  }

  export interface ExtensionAPI {
    exec(cmd: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
    on(
      event: "session_start" | "session_info_changed",
      handler: (event: any, ctx: ExtensionContext) => Promise<void> | void
    ): void;
    registerCommand(
      name: string,
      config: {
        description: string;
        handler: (args: string[], ctx: ExtensionContext) => Promise<void> | void;
      }
    ): void;
  }
}
