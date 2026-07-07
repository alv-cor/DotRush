# DotRush — AI Agent Guide

DotRush is a lightweight C# development environment for VS Code (and NeoVim/Zed). It is a **VS Code extension** (TypeScript) that spawns several **.NET processes** for language services, debugging, and diagnostics.

## Agent quick start

When making changes, prefer this validation order for fast feedback:

1. TypeScript client only: run `tsc: watch` VS Code task (or `npm run watch`).
2. Roslyn server only: `dotnet cake --target=server`.
3. Debugging components: `dotnet cake --target=debugging`.
4. Server tests: `dotnet cake --target=test`.
5. Full package validation: `dotnet cake --target=vsix --configuration=release`.

If only TypeScript files were edited, skip full Cake targets unless a behavior crosses TS/.NET boundaries.

## Safe editing boundaries

- Preferred edit areas: `src/VSCode/**`, `src/DotRush.Roslyn.*`, `src/DotRush.Common/**`, `src/DotRush.Debugging.Host/**`, `src/DotRush.Debugging.Mono/**`.
- Avoid broad changes in vendored/external code unless explicitly requested:
	- `src/DotRush.Debugging.MonoLib/**`
	- `src/DotRush.Debugging.Diagnostics/**`
- Treat `extension/bin/**` as build/runtime output; do not rely on checked-in artifacts there.

## Architecture: TS client ↔ .NET processes

The extension is a thin TypeScript client that orchestrates standalone .NET executables. There are three distinct out-of-process backends — do not conflate them:

1. **Roslyn Language Server** (`src/DotRush.Roslyn.Server`) — LSP server started by [languageServerController.ts](src/VSCode/controllers/languageServerController.ts) via `vscode-languageclient`. Talks stdio LSP over the `dotrush` scheme. Binary: `extension/bin/LanguageServer/DotRush(.exe)`.
2. **DevHost** (`src/DotRush.Debugging.Host`, aka `devhost.dll`) — a `System.CommandLine` CLI invoked on-demand for MSBuild project evaluation, process listing, template creation, test host, and debugger installation. Called from [interop.ts](src/VSCode/interop/interop.ts) (returns JSON on stdout, deserialized by `ProcessRunner`).
3. **Debuggers** — .NET Core (`vsdbg`/`ncdbg`, installed at runtime by DevHost) and the Mono/Unity debugger (`src/DotRush.Debugging.Mono`, a DAP adapter).

Cross-component calls use two patterns: **LSP notifications** (e.g. `dotrush/projectLoaded`, `dotrush/documentDiagnostics`, `dotrush/solutionDiagnostics`) and **spawn-CLI-parse-JSON** via [interop.ts](src/VSCode/interop/interop.ts) + `ProcessArgumentBuilder`.

### .NET server layering (each is its own csproj, see [DotRush.slnx](src/DotRush.slnx))
- `DotRush.Common` — shared utilities (logging, MSBuild helpers, extensions, interop).
- `DotRush.Roslyn.Workspaces` — loads solutions/projects into a Roslyn `Solution` (`DotRushWorkspace`, `ProjectsController`, `SolutionController`).
- `DotRush.Roslyn.CodeAnalysis` — diagnostics, code actions, compilation (`CompilationHost`, `CodeActionHost`).
- `DotRush.Roslyn.Navigation` — go-to/hover/symbol navigation.
- `DotRush.Roslyn.Server` — LSP entry point wiring services to handlers.

## Server conventions (`DotRush.Roslyn.Server`)

- Handlers live in `Handlers/{TextDocument,Workspace,ExternalAccess}` and extend framework base classes (e.g. `HoverHandlerBase`). Register every handler in [Main.cs](src/DotRush.Roslyn.Server/Main.cs)'s `AddHandler(...)` chain — new LSP features are not active until added there.
- Handlers receive **services** (`WorkspaceService`, `CodeAnalysisService`, `NavigationService`, `ConfigurationService`, `TestExplorerService`) via constructor injection; services are constructed once in `ConfigureServices()`.
- Wrap handler bodies in `SafeExtensions.InvokeAsync(...)` for exception-safe returns, and always thread `CancellationToken` through async Roslyn calls with `.ConfigureAwait(false)`.
- **Multitargeting is first-class**: a file path can map to multiple `DocumentId`s (one per target framework). Use `Solution.GetDocumentIdsWithFilePathV2(...)` and iterate — see [HoverHandler.cs](src/DotRush.Roslyn.Server/Handlers/TextDocument/HoverHandler.cs) for the canonical loop that aggregates results across frameworks.
- The LSP framework is `EmmyLua.LanguageServer.Framework` (namespace `EmmyLua.LanguageServer.Framework.*`), not OmniSharp.

## Build & test workflows

Builds use **Cake** ([build.cake](build.cake)), not raw `dotnet`/`npm`. Run via `dotnet cake --target=<task>`:
- `dotnet cake --target=vsix --configuration=release` — full package (clean → server → debugging → diagnostics → `vsce package`). This is the `vsix` VS Code task.
- `dotnet cake --target=test` — publishes debugger + runs `DotRush.Roslyn.Server.Tests` (NUnit, TRX logs to `artifacts/`).
- `dotnet cake --target=server` — publishes only the language server.

TypeScript watch: the `tsc: watch` VS Code task (`tsc -w -p src/VSCode`) or `npm run watch`. Production bundle is webpack (`npm run package`).

Use Cake tasks as the source of truth for build orchestration; `build.cake` defines clean, publish, test, diagnostics, and VSIX packaging flow.

Common build properties (target frameworks, `Nullable`, central package versions) are in [src/Common.Build.props](src/Common.Build.props) and [src/Directory.Packages.props](src/Directory.Packages.props). Server targets `net10.0` (`ServerTargetFramework`); default `TargetFramework` is `net8.0`.

## Tests (`DotRush.Roslyn.Server.Tests`, NUnit)

- Tests derive from fixtures like `BaseProjectTestFixture`, `MultitargetProjectFixture`, `SimpleWorkspaceFixture`, `NUnitTestProjectFixture` that scaffold real temp projects on disk.
- `InternalsVisibleTo` exposes internals to test assemblies (declared in [Common.Build.props](src/Common.Build.props)).

## Gotchas

- `Console` stdout/stderr/stdin are redirected to `Null` in the server's [Main.cs](src/DotRush.Roslyn.Server/Main.cs) — stdio is reserved for LSP. Use `CurrentSessionLogger` (`DotRush.Common.Logging`), never `Console.WriteLine`, for server logging.
- The server watches the client PID and self-exits when the IDE process dies (`ConfigureProcessObserver`).
- DotRush is **C#-only** — no Razor/XAML/CodeLens language features (see README "Limitations").
- Debuggers are downloaded/installed at runtime into `extension/bin/` by DevHost (`-vsdbg`/`-ncdbg`); they are not committed.

## Key references

- Product/features and user-facing behavior: [README.md](README.md)
- Build orchestration and packaging: [build.cake](build.cake)
- TS extension activation and controller wiring: [main.ts](src/VSCode/main.ts)
- DevHost interop contract: [interop.ts](src/VSCode/interop/interop.ts)
- Alternative editor setup notes: [src/AltEditors/Readme.md](src/AltEditors/Readme.md)
