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

/**
 * Splits a `when` clause into tokens, for the subset package.json uses: key names, `!`, `&&`,
 * `||`, parentheses, and `==` / `!=` against a quoted string. Throws on anything else.
 * @param {string} expression
 * @returns {string[]}
 */
function tokenizeWhen(expression) {
  const pattern = /\s*(\(|\)|&&|\|\||!=|==|!|'[^']*'|[\w.]+)/y;
  /** @type {string[]} */
  const tokens = [];
  const end = expression.trimEnd().length;
  while (pattern.lastIndex < end) {
    const start = pattern.lastIndex;
    const match = pattern.exec(expression);
    if (match === null) {
      throw new Error(`Unsupported syntax at ${start} in: ${expression}`);
    }
    tokens.push(match[1]);
  }
  return tokens;
}

/**
 * Evaluates a `when` clause the way VS Code does, for the subset tokenizeWhen() accepts. A key
 * missing from the context is unset, as in VS Code. It knows nothing of the values VS Code sets:
 * each test gives them.
 * @param {string} expression
 * @param {Readonly<Record<string, unknown>>} context
 * @returns {boolean}
 */
function evaluateWhen(expression, context) {
  const tokens = tokenizeWhen(expression);
  let position = 0;

  /** @param {string} message */
  const fail = (message) => new Error(`${message} at token ${position} in: ${expression}`);

  /** @returns {boolean} */
  const parseOr = () => {
    let value = parseAnd();
    while (tokens[position] === '||') {
      position++;
      const right = parseAnd(); // parsed even when value is true, to consume its tokens
      value = value || right;
    }
    return value;
  };

  /** @returns {boolean} */
  const parseAnd = () => {
    let value = parseUnary();
    while (tokens[position] === '&&') {
      position++;
      const right = parseUnary();
      value = value && right;
    }
    return value;
  };

  /** @returns {boolean} */
  const parseUnary = () => {
    if (tokens[position] === '!') {
      position++;
      return !parseUnary();
    }
    return parsePrimary();
  };

  /** @returns {boolean} */
  const parsePrimary = () => {
    const token = tokens[position++];
    if (token === '(') {
      const value = parseOr();
      if (tokens[position++] !== ')') {
        throw fail('Expected )');
      }
      return value;
    }
    if (token === undefined || !/^[\w.]+$/.test(token)) {
      throw fail(`Expected a key, got ${token}`);
    }
    const operator = tokens[position];
    if (operator !== '==' && operator !== '!=') {
      return Boolean(context[token]);
    }
    position++;
    const literal = tokens[position++];
    if (literal === undefined || !/^'[^']*'$/.test(literal)) {
      throw fail(`Expected a quoted string, got ${literal}`);
    }
    const equal = context[token] === literal.slice(1, -1);
    return operator === '==' ? equal : !equal;
  };

  const result = parseOr();
  if (position !== tokens.length) {
    throw fail(`Unexpected ${tokens[position]}`);
  }
  return result;
}

test.describe('title-bar buttons', () => {
  const SHOW_BUTTONS = 'maximize.showButtons';
  /** @type {Array<{ command: string, when: string }>} */
  const buttons = [...manifest.contributes.menus['editor/title'], ...manifest.contributes.menus['view/title']];

  /**
   * Every layout the title-bar `when` clauses can tell apart.
   * @returns {Array<Record<string, unknown>>}
   */
  const allLayouts = () => {
    /** @type {Array<Record<string, unknown>>} */
    const layouts = [];
    const flags = ['inZenMode', 'panelMaximized', 'editorPartMaximizedEditorGroup'];
    for (let bits = 0; bits < 2 ** flags.length; bits++) {
      /** @type {Record<string, unknown>} */
      const context = {};
      flags.forEach((flag, index) => { context[flag] = (bits & (1 << index)) !== 0; });
      for (const viewLocation of ['panel', 'sidebar']) {
        for (const panelAlignment of ['center', 'left']) {
          for (const panelPosition of ['bottom', 'right']) {
            layouts.push({ ...context, viewLocation, panelAlignment, panelPosition });
          }
        }
      }
    }
    return layouts;
  };

  test.it('declares the setting, on by default', () => {
    const setting = manifest.contributes.configuration.properties[SHOW_BUTTONS];
    assert.equal(setting?.type, 'boolean');
    assert.equal(setting?.default, true);
  });

  for (const button of buttons) {
    test.it(`shows ${button.command} only while ${SHOW_BUTTONS} is on`, () => {
      const layouts = allLayouts();
      const shown = layouts.filter((layout) => evaluateWhen(button.when, { ...layout, [`config.${SHOW_BUTTONS}`]: true }));
      const hidden = layouts.filter((layout) => evaluateWhen(button.when, { ...layout, [`config.${SHOW_BUTTONS}`]: false }));
      assert.ok(shown.length > 0, `${button.command} is never shown, even with the setting on`);
      assert.deepEqual(hidden, [], `${button.command} is shown with the setting off`);
    });
  }
});

test.describe('Ctrl+M keybinding rows', () => {
  /** @type {Array<{ command: string, key: string, when: string }>} */
  const keybindings = manifest.contributes.keybindings;
  const rows = keybindings.filter((binding) => binding.key === 'ctrl+m');

  /**
   * @param {Readonly<Record<string, unknown>>} context
   * @returns {string[]} the commands whose row matches
   */
  const matchingCommands = (context) =>
    rows.filter((row) => evaluateWhen(row.when, context)).map((row) => row.command);

  /**
   * The focus keys VS Code sets for each place the keyboard focus can be. A web view in a side
   * bar or the panel, such as a chat, sets none: VS Code draws it in an overlay outside its part,
   * with only the global context keys.
   * @type {Readonly<Record<string, Readonly<Record<string, boolean>>>>}
   */
  const FOCUS = {
    editor: { editorAreaFocus: true },
    sideBar: { sideBarFocus: true },
    panel: { panelFocus: true },
    secondarySideBar: { auxiliaryBarFocus: true },
    webview: {},
  };

  test.it('matches at most one row in every layout', () => {
    const flags = ['inZenMode', 'panelMaximized', 'auxiliaryBarMaximized', 'auxiliaryBarVisible',
      'editorPartMaximizedEditorGroup'];
    for (const [focus, focusKeys] of Object.entries(FOCUS)) {
      for (let bits = 0; bits < 2 ** flags.length; bits++) {
        /** @type {Record<string, unknown>} */
        const context = { ...focusKeys };
        flags.forEach((flag, index) => { context[flag] = (bits & (1 << index)) !== 0; });
        // Layouts VS Code can't be in: a maximized secondary side bar hides every other part,
        // and only a visible one can have focus.
        const secondaryFocus = focus === 'secondarySideBar' || focus === 'webview';
        if (context.auxiliaryBarMaximized && (!context.auxiliaryBarVisible || !secondaryFocus)) {
          continue;
        }
        if (focus === 'secondarySideBar' && !context.auxiliaryBarVisible) {
          continue;
        }
        for (const panelAlignment of ['center', 'left']) {
          for (const panelPosition of ['bottom', 'right']) {
            const layout = { ...context, panelAlignment, panelPosition };
            const matches = matchingCommands(layout);
            assert.ok(matches.length <= 1, `${matches.join(' and ')} both match ${JSON.stringify(layout)}`);
          }
        }
      }
    }
  });

  /** @type {Array<[string, Record<string, unknown>, string]>} */
  const SITUATIONS = [
    ['an editor', { ...FOCUS.editor, auxiliaryBarVisible: true }, 'maximize.maximizeEditor'],
    ['the Explorer', { ...FOCUS.sideBar, auxiliaryBarVisible: true }, 'maximize.maximizeEditor'],
    ['the terminal panel', { ...FOCUS.panel, panelAlignment: 'center', panelPosition: 'bottom' },
      'maximize.maximizePanel'],
    ['a native view in the secondary side bar', { ...FOCUS.secondarySideBar, auxiliaryBarVisible: true },
      'maximize.toggleSecondarySideBar'],
    ['a web view chat in the secondary side bar', { ...FOCUS.webview, auxiliaryBarVisible: true },
      'maximize.toggleSecondarySideBar'],
    ['a web view chat in the maximized secondary side bar',
      { ...FOCUS.webview, auxiliaryBarVisible: true, auxiliaryBarMaximized: true }, 'maximize.toggleSecondarySideBar'],
    ['a web view with the secondary side bar closed', { ...FOCUS.webview }, 'maximize.maximizeEditor'],
    ['an editor in Zen Mode', { ...FOCUS.editor, inZenMode: true }, 'maximize.restore'],
    ['an editor in Zen Mode with its group maximized',
      { ...FOCUS.editor, inZenMode: true, editorPartMaximizedEditorGroup: true }, 'maximize.restoreGroupMaximized'],
    ['a web view chat beside a panel still maximized after Esc Esc',
      { ...FOCUS.webview, auxiliaryBarVisible: true, panelMaximized: true }, 'maximize.restorePanelMaximized'],
  ];
  for (const [place, context, expected] of SITUATIONS) {
    test.it(`runs ${expected} from ${place}`, () => {
      assert.deepEqual(matchingCommands(context), [expected]);
    });
  }
});
