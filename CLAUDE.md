# CLAUDE.md — vscode-maximize

A VS Code extension: Ctrl+M or a title-bar button maximizes whatever has focus (an editor, the
panel, the secondary side bar) and restores the layout the same way. **What it does, the buttons,
the settings it changes, the shortcut and the limitations are in [README.md](README.md). It's the
single source, so don't restate it here.**

## Conventions

- **Plain JavaScript (CommonJS), no build step, no runtime dependencies.** Types are JSDoc with
  `// @ts-check` in every file, checked strictly by `npm run check`.
- **Indentation and line endings follow `.editorconfig`:** 2 spaces, LF. `.gitattributes` holds git
  to LF whatever each machine's `core.autocrlf`.
- **`src/maximize.js` never imports `vscode`.** All the decisions live there, so plain Node can test
  them. `src/extension.js` only registers commands and talks to the API.
- **Errors are never swallowed:** a failing command is logged with its stack trace to the
  **Maximize** log output channel and shown as an error with a *Show Log* button
  (`reportFailure()`).
- **This repo is public on GitHub:** no personal paths, internal hostnames or user names in
  committed files.
- **Every release gets a [CHANGELOG.md](CHANGELOG.md) entry**, listing only changes a user would
  notice. The Marketplace shows it as the extension's *Changelog* tab.
- **`images/icon.png` is rendered from `images/icon.svg`**, because the Marketplace refuses SVG
  icons. After changing the SVG, render it again at 256×256 with a transparent background, for
  example with headless Edge: `msedge --headless=new --default-background-color=00000000
  --window-size=256,256 --screenshot=<repo>/images/icon.png file:///<repo>/images/icon.svg`

## Testing a change

- **Automated:** `npm test` (unit tests, `package.json` consistency, and the Ctrl+M rows' `when`
  clauses evaluated for each situation) and `npm run check`. Run both after every change.
- **By hand, in a real VS Code, after any change to `package.json` or `maximize.js`:** the tests
  evaluate the `when` clauses only against the context values they assume VS Code sets. Press F5,
  then, in the Extension Development Host:
  - editor, one group: Ctrl+M maximizes, Ctrl+M restores the side bars and panel that were open
  - editor, two split groups: the same, and only the active group is shown while maximized
  - the ⛶ button and the tab menu on an *inactive* group: that group is the one maximized
  - terminal focused: Ctrl+M fills the window, Ctrl+M restores, and the shell gets no Enter key
  - secondary side bar focused: Ctrl+M maximizes it and restores it
  - a web view chat in the secondary side bar (Claude Code, for example): the same
  - a web view editor tab (a Markdown preview, for example): Ctrl+M maximizes the editor
  - Esc Esc out of each maximized state, then Ctrl+M: it maximizes or restores cleanly, with no
    half-restored layout
  - `maximize.showButtons` off: no ⛶ button in the editor or panel title bar, maximized or not,
    while Ctrl+M and the tab menu still work. Turned back on, the buttons return with no reload
  - `maximize.editorButtonPosition` and `maximize.panelButtonPosition` switched between `left` and
    `right`: the button moves to that end at once, maximized or not, in the editor and the terminal
  - *change it in Keyboard Shortcuts*, under *Maximize: Show Buttons* in Settings: Keyboard
    Shortcuts opens filtered on `maximize.`, listing the six Ctrl+M rows
  - a Markdown file with *Markdown All in One* and its buttons on
    (`markdown.extension.showActionButtons`): on the left, the ⛶ button stays, first in the row.
    The Ctrl+M conflict warning shows at every F5 start, since the development host never records
    it, and *Show Shortcuts* lists every Ctrl+M row, theirs included

## Design decisions

- **The layout state travels only through `when` clauses.** Extensions can't read context keys
  (`getContextKeyInfo` lists their definitions, not their values), so each situation has its own
  keybinding row and menu entry calling its own command. `COMMAND_REQUESTS` maps each command to
  what it does.
- **Commands take no keybinding `args`.** The Keyboard Shortcuts editor drops `args` when the user
  changes a key, but keeps `when`. A design based on `args` broke the moment someone rebound it.
- **Zen Mode does the bookkeeping.** Entering it records which side bars and panel are visible,
  and leaving it shows them again. So:
  - **Zen Mode is always entered first**, before maximizing a group or the panel.
  - **On restore, the panel or group is un-maximized first:** leaving Zen Mode doesn't touch a
    maximized panel, which would keep the editor area hidden.
- **A maximized panel always routes to restore, in or out of Zen Mode.** After Esc Esc the panel
  stays maximized, and maximizing again would have toggled it back.
- **Keyboard maximize uses `maximizeEditorHideSidebar`**, which never toggles, because the keyboard
  row can't tell whether a group is already maximized. **Menus use `toggleMaximizeEditorGroup`
  with the menu arguments**, so the clicked group is the one maximized. Their `when` clauses pick
  the `…GroupMaximized` variant when a group already is.
- **The terminal needs every command in `commandsToSkipShell`.** Otherwise xterm.js sends the key to
  the shell. A user's own list replaces the extension's default, hence the one-time warning in
  `checkTerminalSkipList()`.
- **The secondary side bar uses VS Code's own maximize**, which already hides and restores
  everything else.
- **Web views outside the editors report no focus.** VS Code draws a side-bar or panel web view in
  an overlay outside its part, with only the global context keys. So inside a chat,
  `auxiliaryBarFocus`, `focusedView` and `viewLocation` are all unset. `editorAreaFocus` is scoped
  to the editor part, and web view editors inherit it. Hence:
  - **the editor row needs `editorAreaFocus` or `sideBarFocus`**, not just "not the panel or the
    secondary side bar"
  - **a key from no part goes to the secondary side bar row** when that bar is visible
- **Each title-bar button is listed twice, at `navigation@-1000` and at `navigation@1000`**, and
  its position setting's `when` turns on one of them: a menu entry's order is fixed in
  package.json. One `when` tests `!=` the non-default value and the other `==`, so any value turns
  on exactly one.
- **The editor buttons default to the left.** VS Code shows at most 9 editor title buttons and
  moves the rest into ⋯ in menu order. On the right, ours went first once other extensions added
  theirs. The panel's view toolbar has no such cap, so its buttons default to the right.
- **Another extension's binding can outrank our Ctrl+M rows, and no row order prevents it.** VS
  Code ranks an extension's keybinding by its position in its own list, then by command ID, never
  by `when`, and six rows can't all sit late enough. So `findKeybindingConflicts()` applies that
  ranking and `checkKeybindingConflicts()` warns about each conflict. What users see is in the
  README's *Changing the shortcut*.
- **A conflict warning is recorded only once the user closes it or clicks its button.** A warning
  toast hides in the bell after a few seconds, and 0.2.1, which recorded it on showing, lost it for
  good. **Nothing is recorded in the Extension Development Host:** it shares globalState with the
  installed copy, and an F5 run there used up the installed copy's only warning.
- **The shortcut lives in Keyboard Shortcuts, linked from *Show Buttons*' description.** A setting
  can't hold a keybinding. A preset-key dropdown would have needed six gated rows per key, so the
  user chose the link. A link-only `"type": "null"` entry would show an *Edit in settings.json*
  link, so the link sits in the first setting's description.
- **Not done yet (ideas):**
  - maximizing the primary side bar (VS Code has no maximize for it)
