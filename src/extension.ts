import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Orchestrator Connector');
  context.subscriptions.push(log);
  log.appendLine('Orchestrator Connector activated.');
}

export function deactivate(): void {}
