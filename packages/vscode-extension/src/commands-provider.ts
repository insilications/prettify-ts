import type { TypeInfo } from "@prettify-ts/typescript-plugin/src/type-tree/types";
import * as vscode from "vscode";
import { stringifyTypeTree, prettyPrintTypeString } from "./stringify-type-tree";

import type { PrettifyRequest } from "@prettify-ts/typescript-plugin/src/request";

// MAX_SETTINGS is an extremely high constant used to represent "unlimited" or "maximum possible" settings.
// It is intended for advanced scenarios (e.g., full type tree processing) and may have performance implications.
const MAX_SETTINGS = 999999999999;

export function registerCommands(context: vscode.ExtensionContext): void {
  const toggleCommand = vscode.commands.registerCommand("prettify-ts.toggle", async (option?: boolean) => {
    const config = vscode.workspace.getConfiguration("prettify-ts");
    if (option === true || option === false) {
      await config.update("enabled", option, vscode.ConfigurationTarget.Global);
      return;
    }

    await config.update("enabled", !config.get("enabled", true), vscode.ConfigurationTarget.Global);
  });

  async function copyType(full = false): Promise<void> {
    const config = vscode.workspace.getConfiguration("prettify-ts");
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const indentation = config.get("typeIndentation", 4);
    const options = {
      hidePrivateProperties: config.get("hidePrivateProperties", true),
      maxDepth: config.get("maxDepth", 2),
      maxProperties: config.get("maxProperties", 100),
      maxSubProperties: config.get("maxSubProperties", 5),
      maxUnionMembers: config.get("maxUnionMembers", 15),
      maxFunctionSignatures: config.get("maxFunctionSignatures", 5),
      skippedTypeNames: config.get("skippedTypeNames", [] as string[]),
      unwrapArrays: config.get("unwrapArrays", true),
      unwrapFunctions: config.get("unwrapFunctions", true),
      unwrapGenericArgumentsTypeNames: config.get("unwrapGenericArgumentsTypeNames", [] as string[]),
    };

    if (full) {
      options.maxDepth = MAX_SETTINGS;
      options.maxProperties = MAX_SETTINGS;
      options.maxSubProperties = MAX_SETTINGS;
      options.maxUnionMembers = MAX_SETTINGS;
      options.maxFunctionSignatures = MAX_SETTINGS;
      options.unwrapArrays = true;
      options.unwrapFunctions = true;
    }

    const request: PrettifyRequest = {
      meta: "prettify-type-info-request",
      options,
    };

    const selection = editor.selection;
    const cursorPosition = selection.active;
    const location = {
      file: editor.document.uri.fsPath,
      line: cursorPosition.line + 1,
      offset: cursorPosition.character + 1,
    };

    const response: any = await vscode.commands.executeCommand("typescript.tsserverRequest", "completionInfo", {
      ...location,
      triggerCharacter: request,
    });

    const prettifyResponse: TypeInfo | undefined = response?.body?.__prettifyResponse;
    if (!prettifyResponse || !prettifyResponse.typeTree) {
      await vscode.window.showErrorMessage("No type information found at cursor position");
      return;
    }

    const { typeTree, span, syntaxKind, returnTypeString } = prettifyResponse;

    const typeString = stringifyTypeTree(typeTree, false);
    const prettyTypeString = prettyPrintTypeString(typeString, indentation);

    // Convert the character offsets from the TSServer response into VS Code Positions
    const identifierStartPos = editor.document.positionAt(span.start);
    const identifierEndPos = editor.document.positionAt(span.end);

    const identifierRange = new vscode.Range(identifierStartPos, identifierEndPos);
    const identifierEnd = identifierRange.end;

    // Get the text after the identifier to check for existing type annotation or assignment
    const currentLine = editor.document.lineAt(identifierEnd.line);
    const textAfterIdentifier = currentLine.text.substring(identifierEnd.character);

    // Check if there's already a type annotation (: Type) after the identifier
    const hasExistingType = /^\s*:/.test(textAfterIdentifier);
    if (hasExistingType) {
      await vscode.window.showInformationMessage("Type annotation already exists");
      return;
    }

    await editor.edit((editBuilder) => {
      const typeAnnotation = `: ${prettyTypeString.trim()}`;

      // Check for an assignment operator after the identifier
      const assignmentMatch = textAfterIdentifier.match(/^(\s*)(=)/);

      if (assignmentMatch) {
        // Case 1: An assignment exists (e.g., `const x = 1`).
        // We will REPLACE the whitespace between the identifier and the '='.

        // The whitespace to replace starts right after the identifier.
        const whitespaceStart = identifierEnd;

        // The whitespace ends right before the '=', which is at a known offset.
        const whitespaceEnd = new vscode.Position(
          identifierEnd.line,
          identifierEnd.character + assignmentMatch[1]!.length
        );

        const replacementRange = new vscode.Range(whitespaceStart, whitespaceEnd);

        // Replace the whitespace with the type annotation, ensuring one space on each side.
        editBuilder.replace(replacementRange, `${typeAnnotation} `);
      } else {
        // Case 2: No assignment (e.g., `let x;` or a function parameter).
        // We can simply INSERT the type annotation.
        editBuilder.insert(identifierEnd, typeAnnotation);
      }
    });

    await vscode.env.clipboard.writeText(
      `: ${prettyTypeString.trim()} - syntaxKind: ${syntaxKind} - returnType: ${returnTypeString ?? "N/A"}`
    );
    // await vscode.env.clipboard.writeText(`: ${prettyTypeString}`);
    await vscode.window.showInformationMessage("Type copied to clipboard");
  }

  const copyFunction = async () =>
    await copyType().catch(() => vscode.window.showErrorMessage("Failed to copy prettified type"));

  const fullCopyFunction = async () =>
    await copyType(true).catch(() => vscode.window.showErrorMessage("Failed to copy fully prettified type"));

  const copyCommand = vscode.commands.registerCommand("prettify-ts.copyPrettifiedType", copyFunction);
  const fullCopyCommand = vscode.commands.registerCommand("prettify-ts.fullCopyPrettifiedType", fullCopyFunction);

  context.subscriptions.push(toggleCommand);
  context.subscriptions.push(copyCommand);
  context.subscriptions.push(fullCopyCommand);
}
