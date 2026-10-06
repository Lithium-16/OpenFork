// What the launcher page may ask of the desktop app.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('launcher', {
  state: () => ipcRenderer.invoke('launcher:state'),
  play: (kind: 'new' | 'continue'): Promise<string | null> => ipcRenderer.invoke('launcher:play', kind),
  load: (): Promise<string | null> => ipcRenderer.invoke('launcher:load'),
  fullscreen: (on: boolean): void => ipcRenderer.send('launcher:fullscreen', on),
  share: (): void => ipcRenderer.send('launcher:share'),
  saves: (): void => ipcRenderer.send('launcher:saves'),
  install: (): void => ipcRenderer.send('launcher:install'),
  minimize: (): void => ipcRenderer.send('launcher:minimize'),
  quit: (): void => ipcRenderer.send('launcher:quit'),
  onUpdate: (fn: (u: unknown) => void): void => {
    ipcRenderer.on('launcher:update', (_e, u) => fn(u));
  },
  onRefresh: (fn: () => void): void => {
    ipcRenderer.on('launcher:refresh', () => fn());
  },
});
