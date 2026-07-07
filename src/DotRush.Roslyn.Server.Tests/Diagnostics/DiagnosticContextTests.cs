using System.Globalization;
using DotRush.Roslyn.CodeAnalysis.Diagnostics;
using DotRush.Roslyn.Server.Services;
using Microsoft.CodeAnalysis.Text;
using NUnit.Framework;

namespace DotRush.Roslyn.Server.Tests;

public class DiagnosticContextTests : MultitargetProjectFixture
{
    private static readonly CultureInfo EnglishCulture = CultureInfo.GetCultureInfo("en");
    private static readonly CultureInfo GermanCulture = CultureInfo.GetCultureInfo("de-DE");

    private CultureInfo? previousCurrentCulture;
    private CultureInfo? previousCurrentUICulture;
    private CultureInfo? previousMessageCulture;

    [SetUp]
    public void SetUp()
    {
        previousCurrentCulture = CultureInfo.CurrentCulture;
        previousCurrentUICulture = CultureInfo.CurrentUICulture;
        previousMessageCulture = DiagnosticContext.MessageCulture;
    }

    [TearDown]
    public void TearDown()
    {
        CultureInfo.CurrentCulture = previousCurrentCulture!;
        CultureInfo.CurrentUICulture = previousCurrentUICulture!;
        DiagnosticContext.MessageCulture = previousMessageCulture!;
    }

    [Test]
    public async Task CaDiagnosticSubjectUsesConfiguredCulture()
    {
        CultureInfo.CurrentCulture = GermanCulture;
        CultureInfo.CurrentUICulture = GermanCulture;
        DiagnosticContext.MessageCulture = GermanCulture;

        var codeAnalysisService = new CodeAnalysisService(new ConfigurationService(null), null);
        var documents = CreateAndGetDocuments(
            nameof(DiagnosticContextTests),
            @"
            namespace Tests;

            public class TestClass {
                public int GetValue() {
                    return 1;
                }
            }
            "
        );

        await codeAnalysisService
            .AnalyzeAsync(
                documents,
                AnalysisScope.None,
                AnalysisScope.Document,
                CancellationToken.None
            )
            .ConfigureAwait(false);

        var document = documents.First();
        var text = await document.GetTextAsync().ConfigureAwait(false);
        var diagnostics = codeAnalysisService.GetDiagnosticsByDocumentSpan(
            document,
            new TextSpan(0, text.Length)
        );
        var caDiagnostic = diagnostics.FirstOrDefault(diagnostic =>
            diagnostic.Id.StartsWith("CA", StringComparison.Ordinal)
        );

        Assert.That(
            caDiagnostic,
            Is.Not.Null,
            "Expected a CA diagnostic from the analyzer pipeline."
        );
        Assert.That(
            caDiagnostic!.GetSubject(),
            Is.EqualTo(caDiagnostic.Diagnostic.GetMessage(GermanCulture))
        );
    }

    [Test]
    public async Task CaDiagnosticSubjectFallsBackToEnglishWhenConfiguredCultureIsEnglish()
    {
        CultureInfo.CurrentCulture = GermanCulture;
        CultureInfo.CurrentUICulture = GermanCulture;
        DiagnosticContext.MessageCulture = EnglishCulture;

        var codeAnalysisService = new CodeAnalysisService(new ConfigurationService(null), null);
        var documents = CreateAndGetDocuments(
            nameof(DiagnosticContextTests),
            @"
            namespace Tests;

            public class TestClass {
                public int GetValue() {
                    return 1;
                }
            }
            "
        );

        await codeAnalysisService
            .AnalyzeAsync(
                documents,
                AnalysisScope.None,
                AnalysisScope.Document,
                CancellationToken.None
            )
            .ConfigureAwait(false);

        var document = documents.First();
        var text = await document.GetTextAsync().ConfigureAwait(false);
        var diagnostics = codeAnalysisService.GetDiagnosticsByDocumentSpan(
            document,
            new TextSpan(0, text.Length)
        );
        var caDiagnostic = diagnostics.FirstOrDefault(diagnostic =>
            diagnostic.Id.StartsWith("CA", StringComparison.Ordinal)
        );

        Assert.That(
            caDiagnostic,
            Is.Not.Null,
            "Expected a CA diagnostic from the analyzer pipeline."
        );
        Assert.That(
            caDiagnostic!.GetSubject(),
            Is.EqualTo(caDiagnostic.Diagnostic.GetMessage(EnglishCulture))
        );
    }
}
