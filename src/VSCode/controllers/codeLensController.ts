import { ReferenceCodeLensProvider } from '../providers/referenceCodeLensProvider';
import * as vscode from 'vscode';

export class CodeLensController {
    public static activate(context: vscode.ExtensionContext): void {
        const provider = new ReferenceCodeLensProvider();
        context.subscriptions.push(provider);
        context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'csharp' }, provider));
    }
}