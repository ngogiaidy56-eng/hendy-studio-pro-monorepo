const { contextBridge } = require('electron');
// Deliberately expose no filesystem, process, shell or IPC capabilities to remote page code.
contextBridge.exposeInMainWorld('hendyDesktop', Object.freeze({
  name: 'Hendy Studio Pro',
  channel: 'desktop',
  version: process.env.npm_package_version || '1.2.0',
}));
