import { Extensions } from '../extensions';
import * as res from '../resources/constants';
import * as vscode from 'vscode';

type LensData = {
    uri: vscode.Uri;
    position: vscode.Position;
};

type DataCodeLens = vscode.CodeLens & {
    data?: LensData;
};

type SymbolContext = 'root' | 'type' | 'member';

export class ReferenceCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly codeLensesChanged = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this.codeLensesChanged.event;
    private readonly subscriptions: vscode.Disposable[] = [];

    public constructor() {
        this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => this.codeLensesChanged.fire()));
        this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => this.codeLensesChanged.fire()));
        this.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(`${res.extensionId}.${res.configIdRoslynShowReferencesCodeLens}`))
                this.codeLensesChanged.fire();
        }));
    }

    public dispose(): void {
        this.codeLensesChanged.dispose();
        for (const subscription of this.subscriptions)
            subscription.dispose();
    }

    public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        if (!Extensions.getSetting<boolean>(res.configIdRoslynShowReferencesCodeLens, true))
            return [];

        const documentSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        if (token.isCancellationRequested || documentSymbols === undefined)
            return [];

        const result: vscode.CodeLens[] = [];
        this.collectCodeLenses(documentSymbols, 'root', document.uri, document, result, token);
        return result;
    }

    public async resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken): Promise<vscode.CodeLens> {
        const lens = codeLens as DataCodeLens;
        if (lens.data === undefined)
            return codeLens;

        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            lens.data.uri,
            lens.data.position
        );

        if (token.isCancellationRequested)
            return codeLens;

        const usages = (references ?? []).filter(location => !this.isDeclarationReference(location, lens.data!));
        const count = usages.length;
        codeLens.command = {
            title: `${count} reference${count === 1 ? '' : 's'}`,
            command: 'editor.action.showReferences',
            arguments: [lens.data.uri, lens.data.position, usages]
        };

        return codeLens;
    }

    private collectCodeLenses(
        symbols: vscode.DocumentSymbol[],
        context: SymbolContext,
        documentUri: vscode.Uri,
        document: vscode.TextDocument,
        result: vscode.CodeLens[],
        token: vscode.CancellationToken
    ): void {
        for (const symbol of symbols) {
            if (token.isCancellationRequested)
                return;

            const isType = this.isTypeSymbol(symbol.kind);
            const isMember = context === 'type' && this.isTypeMemberSymbol(symbol.kind);
            if (isType || isMember) {
                const lens = new vscode.CodeLens(symbol.selectionRange) as DataCodeLens;
                lens.data = {
                    uri: documentUri,
                    position: this.getReferencePosition(document, symbol)
                };
                result.push(lens);
            }

            const childContext: SymbolContext = isType ? 'type' : isMember ? 'member' : context;
            this.collectCodeLenses(symbol.children, childContext, documentUri, document, result, token);
        }
    }

    private getReferencePosition(document: vscode.TextDocument, symbol: vscode.DocumentSymbol): vscode.Position {
        const declarationLine = symbol.range.start.line;
        const lineText = document.lineAt(declarationLine).text;

        const preferredStart = Math.min(symbol.selectionRange.start.character, lineText.length);
        for (const candidate of this.getSymbolNameCandidates(symbol.name)) {
            const indexFromSelection = this.findCandidateIndex(lineText, candidate, preferredStart);
            if (indexFromSelection >= 0)
                return new vscode.Position(declarationLine, indexFromSelection);

            const rangeStart = Math.min(symbol.range.start.character, lineText.length);
            const indexFromRange = this.findCandidateIndex(lineText, candidate, rangeStart);
            if (indexFromRange >= 0)
                return new vscode.Position(declarationLine, indexFromRange);
        }

        return symbol.selectionRange.start;
    }

    private getSymbolNameCandidates(name: string): string[] {
        const candidates: string[] = [];

        const withoutParameters = name.split('(')[0].trim();
        const withoutTypeArguments = withoutParameters.replace(/<.*>/g, '').trim();
        const withoutQualifier = withoutTypeArguments.includes('.')
            ? withoutTypeArguments.substring(withoutTypeArguments.lastIndexOf('.') + 1).trim()
            : withoutTypeArguments;

        this.tryAddCandidate(candidates, name.trim());
        this.tryAddCandidate(candidates, withoutParameters);
        this.tryAddCandidate(candidates, withoutTypeArguments);
        this.tryAddCandidate(candidates, withoutQualifier);

        return candidates;
    }

    private tryAddCandidate(candidates: string[], value: string): void {
        if (value.length === 0)
            return;
        if (!candidates.includes(value))
            candidates.push(value);
    }

    private findCandidateIndex(lineText: string, candidate: string, fromIndex: number): number {
        const startIndex = Math.max(fromIndex, 0);
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\b${escaped}\\b`, 'g');

        pattern.lastIndex = startIndex;
        const fromStart = pattern.exec(lineText);
        if (fromStart !== null)
            return fromStart.index;

        pattern.lastIndex = 0;
        const anywhere = pattern.exec(lineText);
        return anywhere?.index ?? -1;
    }

    private isTypeSymbol(kind: vscode.SymbolKind): boolean {
        return kind === vscode.SymbolKind.Class
            || kind === vscode.SymbolKind.Struct
            || kind === vscode.SymbolKind.Interface
            || kind === vscode.SymbolKind.Enum;
    }

    private isTypeMemberSymbol(kind: vscode.SymbolKind): boolean {
        return kind === vscode.SymbolKind.Method
            || kind === vscode.SymbolKind.Constructor
            || kind === vscode.SymbolKind.Property
            || kind === vscode.SymbolKind.Field
            || kind === vscode.SymbolKind.Event
            || kind === vscode.SymbolKind.EnumMember;
    }

    private isDeclarationReference(location: vscode.Location, data: LensData): boolean {
        return location.uri.toString() === data.uri.toString() && location.range.contains(data.position);
    }
}