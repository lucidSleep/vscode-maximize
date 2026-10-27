// @ts-check
'use strict';

const vscode = require('vscode');
const { COMMAND_REQUESTS, findKeybindingConflicts, findSkipListGap, runToggle } = require('./maximize');

const SKIP_LIST_SECTION = 'terminal.integrated';
const SKIP_LIST_KEY = 'commandsToSkipShell';
/** globalState key: the user chose "Don't Ask Again" on the skip-list warning. */
const SKIP_LIST_PROMPT_DISMISSED = 'skipListPromptDismissed';
/** globalState key: the keybinding conflicts already reported, so each is reported only once. */
const REPORTED_KEYBINDING_CONFLICTS = 'reportedKeybindingConflicts';

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const log = vscode.window.createOutputChannel('Maximize', { log: true });
  context.subscriptions.push(log);

  /** @type {import('./maximize').Workbench} */
  const workbench = {
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    editorGroupCount: () => vscode.window.tabGroups.all.length,
  };

  for (const [command, request] of Object.entries(COMMAND_REQUESTS)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        command,
        reportingFailures(log, command, (/** @type {unknown[]} */ ...menuArgs) =>
          runToggle(request, workbench, menuArgs)),
      ),
    );
  }

  checkTerminalSkipList(context, log).then(undefined, (error) =>
    reportFailure(log, 'Checking the terminal skip list', error));

  // Checked again whenever an extension is installed, removed, enabled or disabled.
  const checkConflicts = () => checkKeybindingConflicts(context, log).then(undefined, (error) =>
    reportFailure(log, 'Checking for shortcut conflicts', error));
  checkConflicts();
  context.subscriptions.push(vscode.extensions.onDidChange(checkConflicts));
}

function deactivate() {
  // Nothing to clean up: everything registered is in context.subscriptions.
}

/**
 * Wraps a command handler so a failure is logged with its stack trace and shown to the user,
 * with a button that opens the log.
 * @param {vscode.LogOutputChannel} log
 * @param {string} name
 * @param {(...args: any[]) => Promise<void>} handler
 * @returns {(...args: any[]) => Promise<void>}
 */
function reportingFailures(log, name, handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      reportFailure(log, name, error);
    }
  };
}

/**
 * @param {vscode.LogOutputChannel} log
 * @param {string} what
 * @param {unknown} error
 */
function reportFailure(log, what, error) {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  log.error(`${what} failed: ${detail}`);
  vscode.window.showErrorMessage(`Maximize: ${what} failed: ${message}`, 'Show Log').then(
    (choice) => {
      if (choice === 'Show Log') {
        log.show();
      }
    },
    (notifyError) => log.error(`Could not show the error notification: ${String(notifyError)}`),
  );
}

/**
 * Warns, once, when the user's own `terminal.integrated.commandsToSkipShell` list hides the
 * default this extension sets: the maximize key would then go to the shell instead.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.LogOutputChannel} log
 * @returns {Promise<void>}
 */
async function checkTerminalSkipList(context, log) {
  if (context.globalState.get(SKIP_LIST_PROMPT_DISMISSED) === true) {
    return;
  }
  const configuration = vscode.workspace.getConfiguration(SKIP_LIST_SECTION);
  const gap = findSkipListGap(configuration.inspect(SKIP_LIST_KEY));
  if (gap === undefined) {
    return;
  }

  const settingName = `${SKIP_LIST_SECTION}.${SKIP_LIST_KEY}`;
  const choice = await vscode.window.showWarningMessage(
    `Maximize: in the terminal, the maximize shortcut goes to the shell. Your ${gap.scope} ` +
      `setting "${settingName}" replaces the default list that would send it to VS Code. ` +
      `Add the ${gap.missing.length} Maximize commands it leaves out?`,
    'Add Them',
    "Don't Ask Again",
  );
  if (choice === 'Add Them') {
    const target = gap.scope === 'workspace'
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await configuration.update(SKIP_LIST_KEY, [...gap.list, ...gap.missing], target);
    log.info(`Added ${gap.missing.join(', ')} to the ${gap.scope} setting ${settingName}.`);
  } else if (choice === "Don't Ask Again") {
    await context.globalState.update(SKIP_LIST_PROMPT_DISMISSED, true);
  }
}

/**
 * Warns, once per binding, when another extension binds the maximize key in a way VS Code ranks
 * above ours: wherever that binding's `when` clause holds, the key runs its command instead.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.LogOutputChannel} log
 * @returns {Promise<void>}
 */
async function checkKeybindingConflicts(context, log) {
  const others = vscode.extensions.all
    .filter((extension) => extension.id !== context.extension.id)
    .map(describeExtension);
  const conflicts = findKeybindingConflicts(
    context.extension.packageJSON.contributes?.keybindings, others, keybindingPlatform());
  const stored = context.globalState.get(REPORTED_KEYBINDING_CONFLICTS);
  const reported = Array.isArray(stored) ? stored.filter((entry) => typeof entry === 'string') : [];
  const fresh = conflicts.filter((conflict) => !reported.includes(conflictId(conflict)));
  if (fresh.length === 0) {
    return;
  }

  // Recorded before the warning shows, so a check that runs while it is still open doesn't repeat it.
  await context.globalState.update(REPORTED_KEYBINDING_CONFLICTS, [...reported, ...fresh.map(conflictId)]);
  for (const conflict of fresh) {
    log.warn(`${conflict.extensionId} binds ${conflict.key} to ${conflict.command}, which VS Code runs ` +
      `instead of ${conflict.outranked.join(', ')} wherever its when clause holds.`);
  }
  const described = fresh
    .map((conflict) => `${conflict.extensionName} binds ${displayKey(conflict.key)} to "${commandTitle(conflict)}"`)
    .join('; ');
  const choice = await vscode.window.showWarningMessage(
    `Maximize: ${described}. VS Code runs ${fresh.length === 1 ? 'that' : 'those'} instead of the ` +
      'maximize shortcut wherever both apply. Remove or change one of them in Keyboard Shortcuts.',
    'Show Shortcuts',
  );
  if (choice === 'Show Shortcuts') {
    // In double quotes, Keyboard Shortcuts matches the key exactly: it lists every row bound to it.
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', `"${fresh[0].key}"`);
  }
}

/**
 * @param {vscode.Extension<unknown>} extension
 * @returns {import('./maximize').OtherExtension}
 */
function describeExtension(extension) {
  const manifest = extension.packageJSON;
  return {
    id: extension.id,
    name: localizedText(manifest.displayName) ?? extension.id,
    builtIn: manifest.isBuiltin === true,
    keybindings: manifest.contributes?.keybindings,
  };
}

/**
 * @param {import('./maximize').KeybindingConflict} conflict
 * @returns {string} the title the extension gives the conflicting command, else its ID
 */
function commandTitle(conflict) {
  const declared = vscode.extensions.getExtension(conflict.extensionId)?.packageJSON.contributes?.commands;
  const command = Array.isArray(declared)
    ? declared.find((entry) => entry !== null && typeof entry === 'object' && entry.command === conflict.command)
    : undefined;
  return localizedText(command?.title) ?? conflict.command;
}

/**
 * @param {unknown} text a string from an extension's package.json
 * @returns {string | undefined} the text, unless it's missing or a `%key%` placeholder VS Code had
 *   no translation for
 */
function localizedText(text) {
  return typeof text === 'string' && text !== '' && !/^%.*%$/.test(text) ? text : undefined;
}

/**
 * @param {string} key normalized: `ctrl+shift+m`
 * @returns {string} as VS Code shows it: `Ctrl+Shift+M`
 */
function displayKey(key) {
  return key.replace(/(^|[+ ])([a-z])/g, (_, separator, letter) => separator + letter.toUpperCase());
}

/** @param {import('./maximize').KeybindingConflict} conflict */
function conflictId(conflict) {
  return `${conflict.extensionId} ${conflict.command} ${conflict.key}`;
}

/**
 * Which of a binding's keys VS Code uses here. In a remote window the extension host can run on
 * another system than the window, and this then guesses wrong: a needless or a missed warning.
 * @returns {import('./maximize').KeybindingPlatform}
 */
function keybindingPlatform() {
  if (process.platform === 'win32') {
    return 'win';
  }
  if (process.platform === 'darwin') {
    return 'mac';
  }
  return 'linux';
}

module.exports = { activate, deactivate };
