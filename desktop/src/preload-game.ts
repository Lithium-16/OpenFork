// What the game page may ask of the desktop app (window.openforkDesktop; see client/desktop.ts).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openforkDesktop', {
  start: (): Promise<{ name: string; load: string | null } | null> => ipcRenderer.invoke('game:start'),
  flush: (): Promise<void> => ipcRenderer.invoke('game:flush'),
  toLauncher: (error?: string): void => ipcRenderer.send('game:launcher', error),
  saveFile: (name: string, data: string): Promise<string | null> => ipcRenderer.invoke('game:save-file', name, data),
});
