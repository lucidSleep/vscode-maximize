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
 *
 * @typedef {'win' | 'mac' | 'linux'} KeybindingPlatform which of a binding's keys VS Code uses
 *
 * @typedef {object} OtherExtension another installed extension, as far as its keybindings go
 * @property {string} id
 * @property {string} name its display name
 * @property {boolean} builtIn shipped with VS Code
 * @property {unknown} keybindings its `contributes.keybindings`, as declared
 *
 * @typedef {object} KeybindingConflict another extension's keybinding that VS Code runs instead of
 *   ours, wherever its `when` clause holds
 * @property {string} extensionId
 * @property {string} extensionName
 * @property {string} command its command
 * @property {string} key its key, normalized: `ctrl+m`, chords separated by a space
 * @property {string[]} outranked our commands bound to that key that it runs ahead of
 *
 * @typedef {object} RankedKeybinding a contributed keybinding, with the weight VS Code ranks it by
 * @property {string} command
 * @property {string[]} chords its key, one normalized entry per chord
 * @property {number} weight
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

/**
 * How VS Code ranks the keybindings extensions contribute (`KeybindingWeight` in its source). Each
 * gets its base weight plus its 1-based position in its own extension's list. Where several match
 * the key and their `when` clauses, the highest weight runs, and on equal weights the command ID
 * that sorts last. So a binding late in a long list beats one early in a short list, whatever the
 * `when` clauses say, and no row order in package.json can put all of ours first.
 */
const KEYBINDING_WEIGHT = Object.freeze({ builtInExtension: 300, extension: 400 });

/** The modifiers in a fixed order, so equal keys spelled differently compare equal. */
const MODIFIER_ORDER = Object.freeze(['ctrl', 'shift', 'alt', 'meta']);
/** A modifier at the start of a chord, as VS Code spells it: `cmd` and `win` both mean `meta`. */
const MODIFIER_PREFIX = /^(ctrl|shift|alt|meta|cmd|win)[+-]/;

/**
 * Finds other extensions' keybindings that VS Code runs instead of ours: same key, ranked higher.
 * Their `when` clauses can't be evaluated here, so each one found takes the key only where its
 * `when` holds. Markdown All in One's Ctrl+M, for example, takes it in Markdown editors.
 *
 * Only the keys package.json declares are known: a key the user rebound in Keyboard Shortcuts, or a
 * binding they removed there, is invisible to extensions.
 * @param {unknown} ours this extension's `contributes.keybindings`
 * @param {readonly OtherExtension[]} others
 * @param {KeybindingPlatform} platform
 * @returns {KeybindingConflict[]}
 */
function findKeybindingConflicts(ours, others, platform) {
  const ourRows = rankKeybindings(ours, false, platform);
  const ourCommands = new Set(Object.keys(COMMAND_REQUESTS));
  /** @type {KeybindingConflict[]} */
  const conflicts = [];
  for (const extension of others) {
    for (const theirs of rankKeybindings(extension.keybindings, extension.builtIn, platform)) {
      if (ourCommands.has(theirs.command)) {
        continue; // it binds one of our own commands: the key does what ours would
      }
      const outranked = ourRows
        .filter((mine) => chordsOverlap(mine.chords, theirs.chords) && outranks(theirs, mine))
        .map((mine) => mine.command);
      if (outranked.length > 0) {
        conflicts.push({
          extensionId: extension.id,
          extensionName: extension.name,
          command: theirs.command,
          key: theirs.chords.join(' '),
          outranked,
        });
      }
    }
  }
  return conflicts;
}

/**
 * The keybindings an extension contributes for a platform, with their weights.
 * @param {unknown} contributed `contributes.keybindings`: a list, or a single binding
 * @param {boolean} builtIn
 * @param {KeybindingPlatform} platform
 * @returns {RankedKeybinding[]}
 */
function rankKeybindings(contributed, builtIn, platform) {
  const bindings = Array.isArray(contributed) ? contributed : contributed === undefined ? [] : [contributed];
  const baseWeight = builtIn ? KEYBINDING_WEIGHT.builtInExtension : KEYBINDING_WEIGHT.extension;
  /** @type {RankedKeybinding[]} */
  const ranked = [];
  bindings.forEach((binding, index) => {
    // Skipped bindings still count for the position, as in VS Code.
    if (binding === null || typeof binding !== 'object' || typeof binding.command !== 'string'
      || binding.command.startsWith('-')) {
      return;
    }
    // VS Code takes the platform's own key when it's set, else `key`.
    const key = binding[platform] || binding.key;
    if (typeof key !== 'string' || key.trim() === '') {
      return; // no key on this platform
    }
    const chords = key.trim().toLowerCase().split(/\s+/).map(normalizeChord);
    ranked.push({ command: binding.command, chords, weight: baseWeight + index + 1 });
  });
  return ranked;
}

/**
 * @param {string} chord one chord, lower case: `shift+ctrl+m`
 * @returns {string} its modifiers in a fixed order, then its key: `ctrl+shift+m`
 */
function normalizeChord(chord) {
  /** @type {Set<string>} */
  const modifiers = new Set();
  let rest = chord;
  let match = MODIFIER_PREFIX.exec(rest);
  while (match !== null) {
    modifiers.add(match[1] === 'cmd' || match[1] === 'win' ? 'meta' : match[1]);
    rest = rest.slice(match[0].length);
    match = MODIFIER_PREFIX.exec(rest);
  }
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), rest].join('+');
}

/**
 * Two keys compete when one starts with the other: a chord starting with Ctrl+M takes Ctrl+M too.
 * @param {readonly string[]} first
 * @param {readonly string[]} second
 * @returns {boolean}
 */
function chordsOverlap(first, second) {
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  return shorter.every((chord, index) => longer[index] === chord);
}

/**
 * @param {RankedKeybinding} candidate
 * @param {RankedKeybinding} other
 * @returns {boolean} VS Code runs `candidate` rather than `other` where both match
 */
function outranks(candidate, other) {
  return candidate.weight !== other.weight ? candidate.weight > other.weight : candidate.command > other.command;
}

module.exports = {
  BUILT_IN,
  COMMAND_REQUESTS,
  findKeybindingConflicts,
  findSkipListGap,
  runToggle,
};
