declare module "@earendil-works/pi-tui" {
  export const Key: {
    enter: string;
    escape: string;
    up: string;
    down: string;
    backspace: string;
    ctrl(key: string): string;
  };
  export function matchesKey(data: string, keyId: string): boolean;
  export function truncateToWidth(text: string, width: number, ellipsis?: string): string;
  export function visibleWidth(text: string): number;
}

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
      custom<T>(
        factory: (
          tui: { requestRender(): void },
          theme: unknown,
          keybinding: unknown,
          done: (value: T) => void
        ) => { render(width: number): string[]; handleInput(data: string): void }
      ): Promise<T>;
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
