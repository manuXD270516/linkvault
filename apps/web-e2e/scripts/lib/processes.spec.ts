import { describe, expect, it } from 'vitest';
import { isSameCheckoutServe, processTree } from './processes';

const ROOT = 'D:\\projects\\linkvault\\.claude\\worktrees\\e2e-suite';

describe('isSameCheckoutServe (design D3, tarea 2.6c)', () => {
  it('casa un serve de api o worker de este checkout, en cualquier forma de invocarlo', () => {
    for (const command of [
      `"C:\\nvm4w\\nodejs\\node.exe" ${ROOT}\\node_modules\\nx\\bin\\nx.js serve api`,
      `node ${ROOT}\\node_modules\\nx\\bin\\nx.js run worker:serve --watch=false`,
      `node ${ROOT.toLowerCase().replace(/\\/g, '/')}/node_modules/nx/bin/nx.js serve worker`,
    ]) {
      expect(isSameCheckoutServe(command, ROOT, 'win32'), command).toBe(true);
    }
  });

  it('en win32 no distingue mayúsculas', () => {
    const command = `node D:\\PROJECTS\\LinkVault\\.claude\\worktrees\\e2e-suite\\node_modules\\nx\\bin\\nx.js serve api`;
    expect(isSameCheckoutServe(command, ROOT, 'win32')).toBe(true);
    expect(isSameCheckoutServe(command.replace(/\\/g, '/'), ROOT.replace(/\\/g, '/'), 'linux')).toBe(false);
  });

  it('no casa un worktree anidado bajo este checkout', () => {
    expect(isSameCheckoutServe(`node ${ROOT}\\sub\\node_modules\\nx\\bin\\nx.js serve api`, ROOT, 'win32')).toBe(false);
  });

  it('no casa web ni otros targets', () => {
    expect(isSameCheckoutServe(`node ${ROOT}\\node_modules\\nx\\bin\\nx.js serve web`, ROOT, 'win32')).toBe(false);
    expect(isSameCheckoutServe(`node ${ROOT}\\node_modules\\nx\\bin\\nx.js run web-e2e:e2e-stack`, ROOT, 'win32')).toBe(false);
  });
});

describe('processTree', () => {
  it('incluye las raíces y todos sus descendientes, y nada más', () => {
    const tree = processTree(
      [10],
      [
        { pid: 10, ppid: 1, commandLine: 'root' },
        { pid: 11, ppid: 10, commandLine: 'child' },
        { pid: 12, ppid: 11, commandLine: 'grandchild' },
        { pid: 20, ppid: 1, commandLine: 'other' },
      ],
    );
    expect([...tree].sort()).toEqual([10, 11, 12]);
  });
});
