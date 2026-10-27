# Maximize Editor, Terminal & Chat

**One key (Ctrl+M) or one button maximizes whatever you are working in:** an editor, the terminal,
or a chat in the secondary side bar. **The same key or button puts the layout back** the way it was.
It's the "maximize the active part" of IDEs like Eclipse, for VS Code.

VS Code's own maximize commands each stop short:

- **Maximize Editor Group** only hides the *other editor groups*. The side bars and the panel stay,
  and with a single group it does nothing at all.
- **Maximize Panel** only takes over the *editor area*. The side bars stay, so with wide ones the
  terminal barely grows.

## What Ctrl+M does

| Focus is in | Ctrl+M maximizes | Ctrl+M again |
|---|---|---|
| **An editor**: a file, a terminal tab, a chat tab… | **Zen Mode**: side bars, panel and activity bar hidden. With split editors, the active group also fills the editor area. | restores |
| **The panel**: Terminal, Output, Problems, Debug Console… | **The panel fills the whole window** | restores |
| **The secondary side bar**, for example a chat | **VS Code's own Maximize Secondary Side Bar** | restores |

- **Restore brings back exactly the side bars and panel that were visible before.** Zen Mode
  records them when it starts.
- **Leaving Zen Mode some other way is fine** (Esc Esc, Ctrl+K Z). The shortcut and the buttons follow
  VS Code's actual layout, not a state of their own.

## Buttons and menus

- **Editor title bar:** a ⛶ *Maximize Editor* button, which turns into *Restore Layout*. It comes
  first among the buttons there: VS Code shows at most 9 and moves the rest into the **⋯** menu, so
  other extensions' buttons can't push it out.
- **A tab's right-click menu:** *Maximize Editor* / *Restore Layout*, acting on that tab's group.
- **Panel title bar:** ⛶ *Maximize Panel (Full Window)* / *Restore Layout*. It sits next to VS Code's own
  maximize button, which only fills the editor area.
- **Secondary side bar:** VS Code's own maximize button already does the job.
- **Command Palette:** *Maximize: Maximize Editor*, *Maximize: Maximize Panel (Full Window)* and
  *Maximize: Restore Layout*, each shown only when it applies.

**To keep only the shortcut, turn off `maximize.showButtons`** (Settings → *Maximize: Show
Buttons*). The title-bar buttons go at once, with no reload. The tab menu and the Command Palette
entries stay.

## Install

Requires **VS Code 1.140** or later.

- **From the Visual Studio Marketplace:** search for *Maximize Editor, Terminal & Chat* in the
  Extensions view, or run `code --install-extension lucidsleep.vscode-maximize`.
- **From the source:** `git clone https://github.com/lucidSleep/vscode-maximize.git`, then
  `npm install` and `npm run package`, which writes `vscode-maximize-<version>.vsix`. Install it with
  `code --install-extension vscode-maximize-<version>.vsix`, or in the Extensions view, the **…** menu
  → **Install from VSIX…**

## Settings it changes

**The extension ships new defaults** for these settings. Anything you set yourself still wins.

| Setting | VS Code default | With this extension | Why |
|---|---|---|---|
| `zenMode.fullScreen` | `true` | `false` | maximize inside the window, don't go full screen |
| `zenMode.centerLayout` | `true` | `false` | keep the editor at full width |
| `zenMode.showTabs` | `multiple` | `multiple` | keep the tabs, which hold the *Restore Layout* button |
| `zenMode.hideLineNumbers` | `true` | `false` | a maximized editor is still an editor |
| `zenMode.hideStatusBar` | `true` | `false` | keep the status bar |
| `zenMode.silentNotifications` | `true` | `false` | keep notifications |
| `terminal.integrated.commandsToSkipShell` | `[]` | the extension's commands | let the shortcut reach VS Code from inside the terminal |

- **The Zen Mode values apply to VS Code's own Zen Mode too** (Ctrl+K Z). For the original behaviour
  there, set the value back in your `settings.json`.
- **If you set `commandsToSkipShell` yourself, your list replaces the default** instead of adding to
  it, and Ctrl+M in the terminal reaches the shell again. The extension then offers, once, to add its
  commands to your list.

## Changing the shortcut

**Ctrl+M is bound in six rows**, one per layout situation. Extensions can see the layout state
(Zen Mode on, panel maximized…) only through a keybinding's `when` clause, so each situation calls its
own command.

To use another key, open **Keyboard Shortcuts** (Ctrl+K Ctrl+S), search for `maximize.`, and change
the key of each of the six rows. VS Code keeps each row's `when` clause.

**What Ctrl+M replaces:** VS Code's *Toggle Tab Key Moves Focus*. In a terminal, Ctrl+M is
the Enter key for the shell, and this extension now takes it there too.

**Another extension that also binds Ctrl+M may win.** Between two extensions, VS Code doesn't look at
which `when` clause is more specific. It ranks each binding by its position in its own extension's
list. *Markdown All in One*, for example, takes Ctrl+M in Markdown files for *Toggle math
environment*, which types `$$`.

- **The extension warns once for each such binding.** Its *Show Shortcuts* button lists every Ctrl+M
  row in Keyboard Shortcuts: right-click the other extension's row to remove it or change its key.
- **Or remove it in `keybindings.json`**, for example
  `{ "key": "ctrl+m", "command": "-markdown.extension.editing.toggleMath" }`.

## Limitations

- **Double-clicking a tab can't trigger it.** The extension API reports no tab clicks, so the
  double-click keeps VS Code's own behaviour (`workbench.editor.doubleClickTabToToggleEditorGroupSizes`).
- **Maximizing the panel at the top or bottom needs it centre-aligned** (`workbench.panel.alignment:
  center`, the default). This is a VS Code limitation. Otherwise the panel button is hidden and
  Ctrl+M keeps its usual meaning in the panel.
- **Restore also un-maximizes an editor group** you had maximized yourself before.
- **With split editors, VS Code shows its own *Unmaximize Group* button** next to *Restore Layout*
  while maximized. Both work, but only *Restore Layout* also leaves Zen Mode.
- **Chat views and other web views see a key first.** Most pass Ctrl+M on to VS Code. One that uses
  it itself keeps it, and the title-bar button still works there.
- **VS Code doesn't tell which side bar or panel a web view is in.** Ctrl+M from a web view outside
  the editors, such as a chat, maximizes the secondary side bar when it's open, and the editor
  otherwise. That's right for a chat in the secondary side bar, the usual place. For a web view in
  the panel, use the panel's ⛶ button instead.

## Development

```sh
npm install        # dev dependencies only; the extension has no runtime dependencies
npm test           # unit tests (node:test), no VS Code needed
npm run check      # type check: JSDoc types, strict
npm run package    # build the .vsix
```

- **Try it live:** open the folder in VS Code and press **F5**. That starts an Extension Development
  Host window with the extension loaded.
- **`src/maximize.js`** holds the logic. It never imports `vscode`, so the tests drive it with a fake
  workbench.
- **`src/extension.js`** registers the commands and reports any failure, with its stack trace, in
  the **Maximize** output channel.
- **`package.json`** holds the `when` clauses that pick a command for each layout situation.

## License

[MIT](LICENSE)
