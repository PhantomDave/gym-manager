// The Tauri bridge, typed at the one point it enters the app.
//
// `withGlobalTauri` injects these; there is no npm package involved, so the
// declaration lives here rather than coming from @tauri-apps/api.

interface TauriDialogFilter {
  name: string;
  extensions: string[];
}

interface TauriOpenOptions {
  multiple?: boolean;
  directory?: boolean;
  filters?: TauriDialogFilter[];
}

interface Window {
  __TAURI__: {
    core: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
    dialog: {
      open(options?: TauriOpenOptions): Promise<string | string[] | null>;
    };
  };
}
