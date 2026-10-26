// @ts-check
'use strict';

const vscode = require('vscode');
const { COMMAND_REQUESTS, findSkipListGap, runToggle } = require('./maximize');

const SKIP_LIST_SECTION = 'terminal.integrated';
const SKIP_LIST_KEY = 'commandsToSkipShell';
/** globalState key: the user chose "Don't Ask Again" on the skip-list warning. */
const SKIP_LIST_PROMPT_DISMISSED = 'skipListPromptDismissed';

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

module.exports = { activate, deactivate };
