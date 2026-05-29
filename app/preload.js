const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkConnection: ()           => ipcRenderer.invoke('check-connection'),
  createProject:   ()           => ipcRenderer.invoke('create-project'),
  openTab:         (args)       => ipcRenderer.invoke('open-tab', args),
  selectOptions:   (args)       => ipcRenderer.invoke('select-options', args),
  sortAssets:      (args)       => ipcRenderer.invoke('sort-assets', args),
  clickAsset:      (args)       => ipcRenderer.invoke('click-asset', args),
  inputPrompt:     (args)       => ipcRenderer.invoke('input-prompt', args),
  uploadImage:     (args)       => ipcRenderer.invoke('upload-image', args),
  saveImages:      (args)       => ipcRenderer.invoke('save-images', args),
  pickFolder:      ()           => ipcRenderer.invoke('pick-folder'),
  pickImage:       ()           => ipcRenderer.invoke('pick-image'),
  openFolder:      (args)       => ipcRenderer.invoke('open-folder', args),
});
