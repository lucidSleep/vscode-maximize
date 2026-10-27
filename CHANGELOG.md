# Changelog

## 0.3.0 (2026-10-27)

- **New settings `maximize.editorButtonPosition` and `maximize.panelButtonPosition`:** put the ⛶
  button at the left or the right end of the editor and panel title bars. The editor's stays on
  the left by default, where other extensions' buttons can't push it into the ⋯ menu, and the
  panel's on the right. See [Buttons and menus](README.md#buttons-and-menus).
- **A link in Settings to change the shortcut:** *change it in Keyboard Shortcuts*, under
  *Maximize: Show Buttons*, opens Keyboard Shortcuts filtered on the extension's commands.
- **Fixed: the warning about another extension's Ctrl+M could go unseen.** It hid in the
  notification bell after a few seconds and never came back. Now it shows again at the next start
  until you close it or click *Show Shortcuts*, and once more if you missed it in 0.2.1.

## 0.2.1 (2026-10-27)

- **Fixed: the ⛶ button vanished into the ⋯ menu** in editors where other extensions add many
  buttons, Markdown files for example. It now comes first in the editor title bar.
- **A warning when another extension's shortcut takes Ctrl+M first**, such as Markdown All in
  One's *Toggle math environment*, which typed `$$` in Markdown files. It shows once per
  conflicting shortcut, with a button that lists them in Keyboard Shortcuts. See
  [Changing the shortcut](README.md#changing-the-shortcut).

## 0.2.0 (2026-10-27)

- **New setting `maximize.showButtons`:** turn it off to hide the ⛶ *Maximize* and *Restore
  Layout* buttons in the editor and panel title bars, and keep only the shortcut. It's on by
  default. See [Buttons and menus](README.md#buttons-and-menus).

## 0.1.1 (2026-10-27)

- **Fixed: Ctrl+M from a chat in the secondary side bar maximized the editor.** It now maximizes
  the secondary side bar, as it already did from its other views. This affected chats drawn as web
  views, such as Claude Code.

## 0.1.0 (2026-10-27)

- **First release:** Ctrl+M or a title-bar button maximizes the focused editor, panel or secondary
  side bar, and restores the layout the same way. See the [README](README.md).
