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
- **`images/icon.png` is rendered from `images/icon.svg`**, because the Marketplace refuses SVG
  icons. After changing the SVG, render it again at 256×256 with a transparent background, for
  example with headless Edge: `msedge --headless=new --default-background-color=00000000
  --window-size=256,256 --screenshot=<repo>/images/icon.png file:///<repo>/images/icon.svg`

## Testing a change

- **Automated:** `npm test` (unit tests + `package.json` consistency) and `npm run check`. Run both
  after every change.
- **By hand, in a real VS Code, after any change to `package.json` or `maximize.js`:** the tests
  can't evaluate `when` clauses. Press F5, then, in the Extension Development Host:
  - editor, one group: Ctrl+M maximizes, Ctrl+M restores the side bars and panel that were open
  - editor, two split groups: the same, and only the active group is shown while maximized
  - the ⛶ button and the tab menu on an *inactive* group: that group is the one maximized
  - terminal focused: Ctrl+M fills the window, Ctrl+M restores, and the shell gets no Enter key
  - secondary side bar focused: Ctrl+M maximizes it and restores it
  - Esc Esc out of each maximized state, then Ctrl+M: it maximizes or restores cleanly, with no
    half-restored layout

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
- **Not done yet (ideas):**
  - maximizing the primary side bar (VS Code has no maximize for it)
  - the Marketplace listing: the package and the `lucidsleep` publisher are ready, the upload isn't done
