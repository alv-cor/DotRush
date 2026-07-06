import { DebugAdapterController } from './debugAdapterController';
import { StatusBarController } from './statusbarController';
import { Extensions } from '../extensions';
import * as res from '../resources/constants';
import * as vscode from 'vscode';
import * as path from 'path';

export class LaunchController {
    public static activate(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand(res.commandIdLaunchAssociatedProject, async (uri?: vscode.Uri) => {
            await LaunchController.launchAssociatedProject(uri);
        }));
    }

    private static async launchAssociatedProject(uri?: vscode.Uri): Promise<void> {
        const documentUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        const documentPath = documentUri?.fsPath;
        if (documentPath === undefined || path.extname(documentPath).toLowerCase() !== '.cs') {
            vscode.window.showErrorMessage(res.messageNoCsharpEditor);
            return;
        }

        let projectPath = await LaunchController.resolveProjectPath(documentPath);
        if (projectPath === undefined)
            projectPath = await Extensions.selectProjecFile(undefined, true);

        if (projectPath === undefined)
            return;

        await StatusBarController.updateStatusBarState(projectPath);

        const activeProject = StatusBarController.activeProject;
        if (activeProject === undefined) {
            vscode.window.showErrorMessage(res.messageNoProjectFileFound);
            return;
        }

        const targetPath = await DebugAdapterController.getProjectTargetPath(
            activeProject.path,
            StatusBarController.activeConfiguration,
            StatusBarController.activeFramework
        );

        if (targetPath === undefined) {
            vscode.window.showErrorMessage(res.messageNoLaunchTargetFound);
            return;
        }

        const debugStarted = await vscode.debug.startDebugging(Extensions.getWorkspaceFolder(), {
            name: `${activeProject.name} (launch)`,
            type: res.debuggerNetCoreId,
            request: 'launch',
            program: targetPath,
            preLaunchTask: `${res.extensionId}: Build`,
            launchSettingsFilePath: path.join(activeProject.directory, 'Properties', 'launchSettings.json')
        });

        if (!debugStarted)
            vscode.window.showErrorMessage(res.messageFailedToStartDebugging);
    }

    private static async resolveProjectPath(documentPath: string): Promise<string | undefined> {
        const activeProjectPath = StatusBarController.activeProject?.path;
        if (LaunchController.isFileBelongsToProject(documentPath, activeProjectPath))
            return activeProjectPath;

        const projectFiles = await Extensions.getProjectFiles(true);
        const matchingProjectPaths = projectFiles.filter(projectPath => LaunchController.isFileBelongsToProject(documentPath, projectPath));
        if (matchingProjectPaths.length === 1)
            return matchingProjectPaths[0];

        const activePath = matchingProjectPaths.find(projectPath => projectPath === activeProjectPath);
        return activePath;
    }

    private static isFileBelongsToProject(documentPath: string, projectPath?: string): boolean {
        if (projectPath === undefined)
            return false;

        const normalizedDocumentPath = path.normalize(documentPath).toLowerCase();
        const normalizedProjectDirectory = path.normalize(path.dirname(projectPath)).toLowerCase();
        const projectDirectoryWithSeparator = LaunchController.withTrailingSeparator(normalizedProjectDirectory);
        return normalizedDocumentPath.startsWith(projectDirectoryWithSeparator);
    }

    private static withTrailingSeparator(input: string): string {
        if (input.endsWith(path.sep))
            return input;

        return input + path.sep;
    }
}
