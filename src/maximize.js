// @ts-check
'use strict';

/*
 * The maximize / restore logic. It never imports `vscode`, so the tests run on plain Node;
 * extension.js wires it to the real workbench.
 *
 * VS Code gives extensions no way to read the layout state (is Zen Mode on, is an editor group
 * or the panel maximized). The keybindings and menus in package.json read that state in their
 * `when` clauses instead, and call the command whose request matches it.
 *
 * Every command has a fixed request and takes no arguments of its own: the Keyboard Shortcuts
 * editor drops a keybinding's `args` when the user changes its key, so the state can't travel
 * that way.
 */

/**
 * @typedef {'editor' | 'panel' | 'secondarySideBar'} Area
 *
 * @typedef {object} ToggleRequest
 * @property {Area} [area] what to maximize; absent when restoring
 * @property {boolean} [restore] restore the layout instead of maximizing
 * @property {boolean} [groupMaximized] an editor group is maximized right now
 * @property {boolean} [panelMaximized] the panel is maximized right now
 *
 * @typedef {object} Workbench the part of the VS Code API this logic needs
 * @property {(command: string, ...args: unknown[]) => Thenable<unknown>} executeCommand
 * @property {() => number} editorGroupCount
 *
 * @typedef {'global' | 'workspace'} SettingScope
 *
 * @typedef {object} SkipListGap a user-set skip list that leaves some of the commands out
 * @property {SettingScope} scope where the list is set
 * @property {string[]} list the list as set there
 * @property {string[]} missing the commands it leaves out
 */

/** The built-in VS Code commands this extension drives. */
const BUILT_IN = Object.freeze({
  toggleZenMode: 'workbench.action.toggleZenMode',
  // Does nothing outside Zen Mode, unlike toggleZenMode.
  exitZenMode: 'workbench.action.exitZenMode',
  // Hides the editor area so the panel takes its place. Shows the panel first if it is hidden.
  toggleMaximizedPanel: 'workbench.action.toggleMaximizedPanel',
  focusPanel: 'workbench.action.focusPanel',
  // Acts on the group named by menu arguments, else on the active group.
  toggleMaximizeEditorGroup: 'workbench.action.toggleMaximizeEditorGroup',
  // Maximizes the active group without toggling, so it is safe when one is already maximized.
  maximizeEditorHideSidebar: 'workbench.action.maximizeEditorHideSidebar',
  // VS Code's own maximize already hides everything else and restores it.
  toggleMaximizedAuxiliaryBar: 'workbench.action.toggleMaximizedAuxiliaryBar',
});

/**
 * Every command this extension registers, with the request it runs.
 * @type {Readonly<Record<string, Readonly<ToggleRequest>>>}
 */
const COMMAND_REQUESTS = Object.freeze({
  'maximize.maximizeEditor': { area: 'editor' },
  'maximize.maximizeEditorGroupMaximized': { area: 'editor', groupMaximized: true },
  'maximize.maximizePanel': { area: 'panel' },
  'maximize.toggleSecondarySideBar': { area: 'secondarySideBar' },
  'maximize.restore': { restore: true },
  'maximize.restoreGroupMaximized': { restore: true, groupMaximized: true },
  'maximize.restorePanelMaximized': { restore: true, panelMaximized: true },
});

/**
 * Maximizes or restores, as the request says. A failing command stops the sequence and rejects.
 * @param {Readonly<ToggleRequest>} request
 * @param {Workbench} workbench
 * @param {readonly unknown[]} [menuArgs] what a tab or title-bar menu passes: the clicked editor
 * @returns {Promise<void>}
 */
async function runToggle(request, workbench, menuArgs = []) {
  if (request.restore) {
    await restoreLayout(request, workbench);
  } else if (request.area === 'secondarySideBar') {
    await workbench.executeCommand(BUILT_IN.toggleMaximizedAuxiliaryBar);
  } else if (request.area === 'panel') {
    await maximizePanel(workbench);
  } else {
    await maximizeEditor(request, workbench, menuArgs);
  }
}

/**
 * @param {Readonly<ToggleRequest>} request
 * @param {Workbench} workbench
 * @param {readonly unknown[]} menuArgs
 */
async function maximizeEditor(request, workbench, menuArgs) {
  // Zen Mode first: entering it records which side bars and panel are visible, and leaving it
  // shows exactly those again. Maximizing the group first would hide the side bars before Zen
  // Mode records them, and they would stay hidden after restore.
  await workbench.executeCommand(BUILT_IN.toggleZenMode);

  if (request.groupMaximized || workbench.editorGroupCount() < 2) {
    return; // a group is already maximized, or there is only one: nothing more to hide
  }
  if (menuArgs.length > 0) {
    // From a menu: the arguments name the clicked group. The menu's `when` clause guarantees no
    // group is maximized, so the toggle maximizes that one.
    await workbench.executeCommand(BUILT_IN.toggleMaximizeEditorGroup, ...menuArgs);
  } else {
    // From the keyboard or the palette, which can't tell whether a group is maximized already.
    await workbench.executeCommand(BUILT_IN.maximizeEditorHideSidebar);
  }
}

/** @param {Workbench} workbench */
async function maximizePanel(workbench) {
  // Zen Mode hides the panel along with the side bars. Maximizing the panel then shows it again
  // in place of the editor area, so it fills the window.
  await workbench.executeCommand(BUILT_IN.toggleZenMode);
  await workbench.executeCommand(BUILT_IN.toggleMaximizedPanel);
  await workbench.executeCommand(BUILT_IN.focusPanel);
}

/**
 * @param {Readonly<ToggleRequest>} request
 * @param {Workbench} workbench
 */
async function restoreLayout(request, workbench) {
  // Undo the maximized panel or group before leaving Zen Mode. Leaving it only shows the side
  // bars and panel again, and would keep the editor area hidden behind a maximized panel.
  if (request.panelMaximized) {
    await workbench.executeCommand(BUILT_IN.toggleMaximizedPanel);
  }
  if (request.groupMaximized) {
    await workbench.executeCommand(BUILT_IN.toggleMaximizeEditorGroup);
  }
  await workbench.executeCommand(BUILT_IN.exitZenMode);
}

/**
 * The terminal sends a key to the shell unless its command is listed in
 * `terminal.integrated.commandsToSkipShell`. package.json puts every command of this extension
 * in that list's default, but a list the user sets replaces the default instead of adding to it.
 *
 * `commandsToSkipShell` is a window setting, so it has no folder-level value to look at.
 * @param {{ globalValue?: unknown, workspaceValue?: unknown } | undefined} inspection
 *   what `WorkspaceConfiguration.inspect()` returns for the setting
 * @returns {SkipListGap | undefined} the user-set list that leaves commands out, if any
 */
function findSkipListGap(inspection) {
  if (inspection === undefined) {
    return undefined; // the setting isn't registered: no terminal to send keys to
  }
  // The most specific value set is the one in effect.
  /** @type {Array<[SettingScope, unknown]>} */
  const layers = [['workspace', inspection.workspaceValue], ['global', inspection.globalValue]];
  for (const [scope, value] of layers) {
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      return undefined; // not a list: VS Code already flags the setting as invalid
    }
    // A "-command" entry is the user deliberately sending that key to the shell.
    const missing = Object.keys(COMMAND_REQUESTS)
      .filter((command) => !value.includes(command) && !value.includes(`-${command}`));
    return missing.length === 0 ? undefined : { scope, list: value.map(String), missing };
  }
  return undefined; // nothing set: the default from package.json applies
}

module.exports = {
  BUILT_IN,
  COMMAND_REQUESTS,
  findSkipListGap,
  runToggle,
};
