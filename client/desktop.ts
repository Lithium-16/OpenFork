// The desktop app (desktop/), when the game runs inside it: the launcher replaces the home
// screen, and saves go through the app's own file dialog. Absent in a browser.
export interface Desktop {
  /** The person's name, and a save to open (Continue, or a file picked in the launcher). */
  start(): Promise<{ name: string; load: string | null } | null>;
  /** Autosaves the game being played now (before leaving it). */
  flush(): Promise<void>;
  /** Closes the game window and shows the launcher, saying why if something went wrong. */
  toLauncher(error?: string): void;
  /** Asks where to save the file and writes it; the path, or null if cancelled. */
  saveFile(name: string, data: string): Promise<string | null>;
}

export const desktop: Desktop | null = (window as unknown as { openforkDesktop?: Desktop }).openforkDesktop ?? null;
