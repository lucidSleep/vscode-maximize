// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BUILT_IN, COMMAND_REQUESTS, findKeybindingConflicts, findSkipListGap, runToggle } = require('../src/maximize');
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

test.describe('findKeybindingConflicts', () => {
  const OURS = [{ command: 'maximize.maximizeEditor', key: 'ctrl+m', when: 'editorAreaFocus' }];

  /**
   * Another extension whose keybinding list has `binding` at `position` (1-based), after bindings
   * of unrelated keys.
   * @param {object} binding
   * @param {number} [position]
   * @param {boolean} [builtIn]
   * @returns {import('../src/maximize').OtherExtension}
   */
  const extensionWith = (binding, position = 1, builtIn = false) => ({
    id: 'other.extension',
    name: 'Other Extension',
    builtIn,
    keybindings: [
      ...Array.from({ length: position - 1 }, (_, index) => ({ command: `other.filler${index}`, key: `ctrl+f${index + 1}` })),
      binding,
    ],
  });

  /**
   * @param {object} binding
   * @param {{ position?: number, builtIn?: boolean, platform?: import('../src/maximize').KeybindingPlatform }} [options]
   * @returns {string[]} the commands found to outrank ours
   */
  const conflictingCommands = (binding, { position = 1, builtIn = false, platform = 'win' } = {}) =>
    findKeybindingConflicts(OURS, [extensionWith(binding, position, builtIn)], platform)
      .map((conflict) => conflict.command);

  test.it("finds Markdown All in One's Ctrl+M ahead of the editor row", () => {
    // Its toggleMath binding is 6th in its list, with this `when` clause.
    const toggleMath = {
      command: 'markdown.extension.editing.toggleMath',
      key: 'ctrl+m',
      mac: 'cmd+m',
      when: 'editorTextFocus && !editorReadonly && editorLangId =~ /^markdown$|^rmd$|^quarto$/',
    };
    const conflicts = findKeybindingConflicts(manifest.contributes.keybindings,
      [{ ...extensionWith(toggleMath, 6), id: 'yzhang.markdown-all-in-one', name: 'Markdown All in One' }], 'win');
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].extensionName, 'Markdown All in One');
    assert.equal(conflicts[0].key, 'ctrl+m');
    assert.ok(conflicts[0].outranked.includes('maximize.maximizeEditor'), conflicts[0].outranked.join(', '));
  });

  test.it('ranks by position in each list, then by command ID, as VS Code does', () => {
    assert.deepEqual(conflictingCommands({ command: 'other.later', key: 'ctrl+m' }, { position: 2 }), ['other.later']);
    // Same position: the command ID that sorts last wins.
    assert.deepEqual(conflictingCommands({ command: 'zz.sortsLater', key: 'ctrl+m' }), ['zz.sortsLater']);
    assert.deepEqual(conflictingCommands({ command: 'aa.sortsEarlier', key: 'ctrl+m' }), []);
  });

  test.it('ranks built-in extensions below every other extension', () => {
    assert.deepEqual(conflictingCommands({ command: 'builtin.command', key: 'ctrl+m' }, { position: 50, builtIn: true }), []);
  });

  test.it("reads each binding's key for the platform", () => {
    const macOnlyDifferent = { command: 'other.command', key: 'ctrl+m', mac: 'cmd+m' };
    assert.deepEqual(conflictingCommands(macOnlyDifferent, { position: 2, platform: 'win' }), ['other.command']);
    assert.deepEqual(conflictingCommands(macOnlyDifferent, { position: 2, platform: 'mac' }), []);
    const windowsOnly = { command: 'other.command', key: 'ctrl+x', win: 'ctrl+m' };
    assert.deepEqual(conflictingCommands(windowsOnly, { position: 2, platform: 'win' }), ['other.command']);
    assert.deepEqual(conflictingCommands(windowsOnly, { position: 2, platform: 'linux' }), []);
  });

  test.it('compares keys however they are spelled, chords included', () => {
    assert.deepEqual(conflictingCommands({ command: 'other.upper', key: 'Ctrl+M' }, { position: 2 }), ['other.upper']);
    assert.deepEqual(conflictingCommands({ command: 'other.chord', key: 'ctrl+m ctrl+x' }, { position: 2 }), ['other.chord']);
    assert.deepEqual(conflictingCommands({ command: 'other.chord', key: 'ctrl+k ctrl+m' }, { position: 2 }), []);
    const shifted = [{ command: 'maximize.restore', key: 'shift+ctrl+m' }];
    const conflicts = findKeybindingConflicts(shifted, [extensionWith({ command: 'other.command', key: 'ctrl+shift+m' }, 2)], 'win');
    assert.deepEqual(conflicts.map((conflict) => conflict.key), ['ctrl+shift+m']);
  });

  test.it('skips bindings with no command, a removal, or one of our own commands', () => {
    assert.deepEqual(conflictingCommands({ key: 'ctrl+m' }, { position: 2 }), []);
    assert.deepEqual(conflictingCommands({ command: '-other.command', key: 'ctrl+m' }, { position: 2 }), []);
    assert.deepEqual(conflictingCommands({ command: 'maximize.restore', key: 'ctrl+m' }, { position: 2 }), []);
  });

  test.it('accepts a single binding in place of a list', () => {
    const single = { id: 'other.extension', name: 'Other', builtIn: false, keybindings: { command: 'zz.command', key: 'ctrl+m' } };
    assert.deepEqual(findKeybindingConflicts(OURS, [single], 'win').map((conflict) => conflict.command), ['zz.command']);
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

  test.it('links the settings to Keyboard Shortcuts, filtered on every command of the extension', () => {
    const description = contributes.configuration.properties['maximize.showButtons'].markdownDescription;
    const link = /\]\(command:workbench\.action\.openGlobalKeybindings\?([^)]+)\)/.exec(description);
    assert.ok(link, 'no link to Keyboard Shortcuts in the maximize.showButtons description');
    // VS Code decodes a command link's query as JSON: a list of the command's arguments.
    const [query] = JSON.parse(decodeURIComponent(link[1]));
    for (const command of declared) {
      assert.ok(command.includes(query), `the "${query}" filter misses ${command}`);
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
  const POSITIONS = ['left', 'right'];
  /** Each title-bar menu, with the setting that picks the end its buttons sit at. */
  const POSITION_SETTINGS = Object.entries({
    'editor/title': 'maximize.editorButtonPosition',
    'view/title': 'maximize.panelButtonPosition',
  });
  /** @type {Record<string, Array<{ command: string, group: string, when: string }>>} */
  const menus = {
    'editor/title': manifest.contributes.menus['editor/title'],
    'view/title': manifest.contributes.menus['view/title'],
  };
  const buttons = [...menus['editor/title'], ...menus['view/title']];

  /**
   * @param {Readonly<Record<string, unknown>>} layout
   * @param {boolean} showButtons
   * @param {string} position the value of both position settings
   * @returns {Record<string, unknown>} the layout with the extension's settings set
   */
  const withSettings = (layout, showButtons, position) => ({
    ...layout,
    [`config.${SHOW_BUTTONS}`]: showButtons,
    ...Object.fromEntries(POSITION_SETTINGS.map(([, setting]) => [`config.${setting}`, position])),
  });

  /**
   * @param {{ group: string }} button
   * @returns {number} its order in its group: `navigation@-1000` is -1000
   */
  const orderOf = (button) => Number(button.group.split('@')[1]);

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

  test.it('declares the settings, with their defaults', () => {
    const properties = manifest.contributes.configuration.properties;
    assert.equal(properties[SHOW_BUTTONS]?.type, 'boolean');
    assert.equal(properties[SHOW_BUTTONS]?.default, true);
    assert.deepEqual(properties['maximize.editorButtonPosition']?.enum, POSITIONS);
    assert.equal(properties['maximize.editorButtonPosition']?.default, 'left');
    assert.deepEqual(properties['maximize.panelButtonPosition']?.enum, POSITIONS);
    assert.equal(properties['maximize.panelButtonPosition']?.default, 'right');
  });

  test.it('shows each button once, at the end its position setting names', () => {
    // VS Code shows at most 9 editor title buttons and moves the rest into the ⋯ menu, in menu
    // order. Other extensions' buttons sit at order 0 by default, and GitLens's go from -101 to
    // 101, so at -1000 ours always stays.
    for (const [menu, setting] of POSITION_SETTINGS) {
      for (const position of POSITIONS) {
        for (const layout of allLayouts()) {
          const shown = menus[menu].filter((button) => evaluateWhen(button.when, withSettings(layout, true, position)));
          const commands = shown.map((button) => button.command);
          assert.equal(new Set(commands).size, commands.length,
            `${menu} shows ${commands.join(', ')} with ${setting} ${position} in ${JSON.stringify(layout)}`);
          for (const button of shown) {
            const order = orderOf(button);
            assert.ok(position === 'left' ? order <= -1000 : order >= 1000,
              `${button.command} sits at ${button.group} with ${setting} ${position}`);
          }
        }
      }
    }
  });

  test.it('shows a button in the same layouts at either end', () => {
    for (const [menu, setting] of POSITION_SETTINGS) {
      for (const command of new Set(menus[menu].map((button) => button.command))) {
        for (const layout of allLayouts()) {
          /** @param {string} position */
          const shownAt = (position) => menus[menu].some((button) =>
            button.command === command && evaluateWhen(button.when, withSettings(layout, true, position)));
          assert.equal(shownAt('left'), shownAt('right'),
            `${command} shows at one end only, by ${setting}, in ${JSON.stringify(layout)}`);
        }
      }
    }
  });

  for (const button of buttons) {
    test.it(`shows ${button.command} at ${button.group} only while ${SHOW_BUTTONS} is on`, () => {
      const settings = allLayouts().flatMap((layout) => POSITIONS.map((position) => ({ layout, position })));
      const shown = settings.filter(({ layout, position }) => evaluateWhen(button.when, withSettings(layout, true, position)));
      const hidden = settings.filter(({ layout, position }) => evaluateWhen(button.when, withSettings(layout, false, position)));
      assert.ok(shown.length > 0, `${button.command} at ${button.group} is never shown, even with the setting on`);
      assert.deepEqual(hidden, [], `${button.command} at ${button.group} is shown with the setting off`);
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
