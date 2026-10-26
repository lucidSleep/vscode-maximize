// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BUILT_IN, COMMAND_REQUESTS, findSkipListGap, runToggle } = require('../src/maximize');
const manifest = require('../package.json');

const ALL_COMMANDS = Object.keys(COMMAND_REQUESTS);

/**
 * A workbench that records the commands it is asked to run.
 * @param {number} [editorGroupCount]
 * @param {string} [failingCommand] a command that rejects when run
 */
function fakeWorkbench(editorGroupCount = 1, failingCommand = undefined) {
  /** @type {Array<{ command: string, args: unknown[] }>} */
  const calls = [];
  return {
    calls,
    commands: () => calls.map((call) => call.command),
    /**
     * @param {string} command
     * @param {...unknown} args
     */
    executeCommand: async (command, ...args) => {
      calls.push({ command, args });
      if (command === failingCommand) {
        throw new Error(`${command} failed`);
      }
      return undefined;
    },
    editorGroupCount: () => editorGroupCount,
  };
}

test.describe('runToggle', () => {
  test.it('maximizes a single editor group with Zen Mode only', async () => {
    const workbench = fakeWorkbench(1);
    await runToggle(COMMAND_REQUESTS['maximize.maximizeEditor'], workbench);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleZenMode]);
  });

  test.it('enters Zen Mode before maximizing the active group, from the keyboard', async () => {
    const workbench = fakeWorkbench(2);
    await runToggle(COMMAND_REQUESTS['maximize.maximizeEditor'], workbench);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleZenMode, BUILT_IN.maximizeEditorHideSidebar]);
  });

  test.it('maximizes the clicked group, from a menu', async () => {
    const workbench = fakeWorkbench(2);
    const menuArgs = [{ path: '/some/file.txt' }, { groupId: 2 }];
    await runToggle(COMMAND_REQUESTS['maximize.maximizeEditor'], workbench, menuArgs);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleZenMode, BUILT_IN.toggleMaximizeEditorGroup]);
    assert.deepEqual(workbench.calls[1].args, menuArgs);
  });

  test.it('leaves an already maximized group alone', async () => {
    const workbench = fakeWorkbench(3);
    await runToggle(COMMAND_REQUESTS['maximize.maximizeEditorGroupMaximized'], workbench, [{ groupId: 1 }]);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleZenMode]);
  });

  test.it('maximizes the panel over the whole window and focuses it', async () => {
    const workbench = fakeWorkbench(1);
    await runToggle(COMMAND_REQUESTS['maximize.maximizePanel'], workbench);
    assert.deepEqual(workbench.commands(), [
      BUILT_IN.toggleZenMode,
      BUILT_IN.toggleMaximizedPanel,
      BUILT_IN.focusPanel,
    ]);
  });

  test.it("hands the secondary side bar to VS Code's own maximize", async () => {
    const workbench = fakeWorkbench(2);
    await runToggle(COMMAND_REQUESTS['maximize.toggleSecondarySideBar'], workbench);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleMaximizedAuxiliaryBar]);
  });

  test.it('restores by leaving Zen Mode', async () => {
    const workbench = fakeWorkbench(1);
    await runToggle(COMMAND_REQUESTS['maximize.restore'], workbench);
    assert.deepEqual(workbench.commands(), [BUILT_IN.exitZenMode]);
  });

  test.it('un-maximizes the group before leaving Zen Mode', async () => {
    const workbench = fakeWorkbench(2);
    await runToggle(COMMAND_REQUESTS['maximize.restoreGroupMaximized'], workbench);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleMaximizeEditorGroup, BUILT_IN.exitZenMode]);
  });

  test.it('un-maximizes the panel before leaving Zen Mode', async () => {
    const workbench = fakeWorkbench(1);
    await runToggle(COMMAND_REQUESTS['maximize.restorePanelMaximized'], workbench);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleMaximizedPanel, BUILT_IN.exitZenMode]);
  });

  test.it('stops and rejects when a command fails', async () => {
    const workbench = fakeWorkbench(1, BUILT_IN.toggleZenMode);
    await assert.rejects(runToggle(COMMAND_REQUESTS['maximize.maximizePanel'], workbench), /toggleZenMode failed/);
    assert.deepEqual(workbench.commands(), [BUILT_IN.toggleZenMode]);
  });
});

test.describe('findSkipListGap', () => {
  test.it('finds nothing when the user set no list', () => {
    assert.equal(findSkipListGap(undefined), undefined);
    assert.equal(findSkipListGap({}), undefined);
  });

  test.it('finds a user list that leaves the commands out', () => {
    assert.deepEqual(findSkipListGap({ globalValue: ['other.command'] }), {
      scope: 'global',
      list: ['other.command'],
      missing: ALL_COMMANDS,
    });
  });

  test.it('names only the commands that are missing', () => {
    const [first, ...rest] = ALL_COMMANDS;
    assert.deepEqual(findSkipListGap({ globalValue: rest })?.missing, [first]);
  });

  test.it('looks at the workspace list first, as VS Code does', () => {
    const inspection = { globalValue: ALL_COMMANDS, workspaceValue: ['other.command'] };
    assert.equal(findSkipListGap(inspection)?.scope, 'workspace');
    assert.equal(findSkipListGap({ globalValue: ['other.command'], workspaceValue: ALL_COMMANDS }), undefined);
  });

  test.it('respects a list that deliberately sends a command to the shell', () => {
    const [first, ...rest] = ALL_COMMANDS;
    assert.equal(findSkipListGap({ globalValue: [`-${first}`, ...rest] }), undefined);
  });

  test.it('leaves a malformed value to VS Code', () => {
    assert.equal(findSkipListGap({ globalValue: 'maximize.restore' }), undefined);
  });
});

test.describe('package.json', () => {
  const contributes = manifest.contributes;
  const declared = contributes.commands.map((/** @type {{ command: string }} */ c) => c.command);

  test.it('declares exactly the commands the extension registers', () => {
    assert.deepEqual([...declared].sort(), [...ALL_COMMANDS].sort());
  });

  test.it('only puts declared commands in menus', () => {
    for (const [menu, entries] of Object.entries(contributes.menus)) {
      for (const entry of /** @type {Array<{ command: string }>} */ (entries)) {
        assert.ok(declared.includes(entry.command), `${menu} uses undeclared ${entry.command}`);
      }
    }
  });

  test.it('binds keys without args, which the Keyboard Shortcuts editor would drop', () => {
    /** @type {Array<{ command: string, when?: string, args?: unknown }>} */
    const keybindings = contributes.keybindings;
    for (const binding of keybindings) {
      assert.ok(declared.includes(binding.command), `undeclared ${binding.command}`);
      assert.equal(binding.args, undefined, `${binding.command} has args`);
      assert.ok(binding.when, `${binding.command} has no when clause`);
    }
  });

  test.it('sends every command past the terminal shell', () => {
    const skipList = contributes.configurationDefaults['terminal.integrated.commandsToSkipShell'];
    assert.deepEqual([...skipList].sort(), [...ALL_COMMANDS].sort());
  });
});
