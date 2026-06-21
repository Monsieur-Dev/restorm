# Building the C# WASM eval bundle (`resources/dotnet-wasm/`)

The scenario `code` node's **C#** language runs real C# in WebAssembly via a
**prebuilt** .NET runtime vendored at `restorm/resources/dotnet-wasm/`. Unlike
the other code runtimes (Pyodide / wasmoon / ruby.wasm / WebR, all npm
packages), .NET has no npm runtime that evaluates arbitrary C#, so we build a
small WASM library **once** and commit its output. **The build/CI host needs no
.NET SDK** — only whoever (re)generates the bundle does.

This is a turnkey recipe: run it on any machine with the .NET SDK, copy the
output into `resources/dotnet-wasm/`, and commit.

## Prerequisites (only on the machine producing the bytes)

```bash
# .NET 8 SDK or later — https://dotnet.microsoft.com/download
dotnet --version
dotnet workload install wasm-tools
```

## 1. Create the eval-host library project

A `wasmbrowser` library exposes a single `[JSExport]` entry point that compiles
and runs the user's C# with Roslyn scripting and returns JSON. Create a folder
(anywhere outside this repo, e.g. `~/restorm-csharp-eval/`):

`RestormCsharpEval.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk.WebAssembly">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <OutputType>Library</OutputType>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <!-- Trim aggressively but keep Roslyn usable. -->
    <InvariantGlobalization>true</InvariantGlobalization>
    <WasmEnableThreads>false</WasmEnableThreads>
    <!-- The WASM trimmer disables System.Text.Json's reflection path by default;
         re-enable it so the JSON bridge (Serialize/Deserialize<object>) works. -->
    <JsonSerializerIsReflectionEnabledByDefault>true</JsonSerializerIsReflectionEnabledByDefault>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp.Scripting" Version="4.*" />
    <!-- Reference assemblies shipped as byte arrays — REQUIRED on WASM: a
         trimmed/single-file deploy has empty Assembly.Location, so Roslyn can't
         build file-based metadata references ("Can't create a metadata reference
         to an assembly without location"). -->
    <PackageReference Include="Basic.Reference.Assemblies.Net80" Version="1.*" />
  </ItemGroup>
</Project>
```

`Evaluator.cs`

```csharp
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text.Json;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace RestormCsharpEval;

[SupportedOSPlatform("browser")]
public static partial class Evaluator
{
    // Globals exposed to the user's script: `input` (the wired value) and
    // `vars` (run variables), both parsed from JSON into dynamic objects.
    public sealed class Globals
    {
        public dynamic? input { get; set; }
        public dynamic? vars { get; set; }
    }

    [JSExport]
    public static string Eval(string code, string inputJson, string varsJson)
    {
        var logs = new List<string>();
        var writer = new StringWriter();
        var prevOut = Console.Out;
        Console.SetOut(writer);
        try
        {
            var globals = new Globals
            {
                input = JsonSerializer.Deserialize<object?>(inputJson),
                vars  = JsonSerializer.Deserialize<object?>(varsJson),
            };

            var options = ScriptOptions.Default
                .WithImports("System", "System.Linq", "System.Collections.Generic", "System.Text.Json")
                // Byte-array reference assemblies — Assembly.Location is empty on WASM,
                // so file-based references throw; Basic.Reference.Assemblies ships them
                // as images.
                .WithReferences(Basic.Reference.Assemblies.Net80.References.All);

            // Run the user submission. The value of a trailing top-level
            // expression is the script's ReturnValue (REPL semantics).
            var state = CSharpScript.RunAsync(code, options, globals, typeof(Globals))
                .GetAwaiter().GetResult();

            Console.SetOut(prevOut);
            foreach (var line in writer.ToString().Split('\n'))
                if (line.Length > 0) logs.Add(line.TrimEnd('\r'));

            return JsonSerializer.Serialize(new { result = state.ReturnValue, logs });
        }
        catch (Exception e)
        {
            Console.SetOut(prevOut);
            foreach (var line in writer.ToString().Split('\n'))
                if (line.Length > 0) logs.Add(line.TrimEnd('\r'));
            // Unwrap compilation errors to a single readable message.
            var msg = e is CompilationErrorException ce ? string.Join("; ", ce.Diagnostics) : e.Message;
            return JsonSerializer.Serialize(new { error = msg, logs });
        }
    }
}
```

> If `concurrentBuild=false` is needed at a lower level for your .NET version,
> drop to `CSharpCompilation.CreateScriptCompilation(...)` with
> `CSharpCompilationOptions(..., concurrentBuild: false)` and emit/run the script
> assembly manually — the high-level `CSharpScript` path above works on recent
> .NET WASM, but verify on your SDK version.

## 2. Publish to WASM

```bash
dotnet publish RestormCsharpEval.csproj -c Release
```

The `_framework` output lands under
`bin/Release/net8.0/browser-wasm/AppBundle/_framework/` (path varies slightly by
SDK). It contains `dotnet.js`, `dotnet.wasm`, the `*.dll` / `*.wasm` assemblies,
`blazor.boot.json`, and ICU data.

## 3. Vendor the output

```bash
rm -rf restorm/resources/dotnet-wasm/_framework_old      # if replacing
cp -R <publish>/_framework/* restorm/resources/dotnet-wasm/
```

`restorm/resources/dotnet-wasm/` must end up containing `dotnet.js` +
`blazor.boot.json` at its top level (the runtime resolves both there). Keep the
`README.md` in that dir.

### How the runtime finds this dir (don't hard-code a depth)

`csharpRuntime.ts` locates the bundle by walking UP from its own module dir
(`dirname(fileURLToPath(import.meta.url))`) looking for the first ancestor that
contains `resources/dotnet-wasm/dotnet.js`, plus the packaged
`process.resourcesPath/restorm-resources/dotnet-wasm` candidate. This is
deliberate: the compiled module sits at **different depths** depending on
context — `src/main/scenarioEngine/codeRuntimes` under vitest, but
`dist/main/chunks` after the electron-vite build (it nests main into a `chunks/`
subdir). A fixed `../../`-style relative path silently breaks in the built/
packaged app (it resolves to `dist/resources` or the repo root, never
`restorm/resources`), which unit-tests-from-source do NOT catch — only the
golden-capture against the built app does. Keep the ancestor-walk resolver; do
not "simplify" it back to a counted relative path.

## 4. Verify

```bash
cd restorm
npx vitest run src/main/scenarioEngine/codeRuntimes   # C# live tests un-skip + pass
pnpm dev:restorm                                       # add a C# code node, run a scenario
```

## Size / git note

The bundle is on the order of tens of MB (the .NET runtime + Roslyn). Decide
**plain commit vs git-LFS** before vendoring — track `resources/dotnet-wasm/**`
in `.gitattributes` for LFS if the repo policy prefers it.

## Why vendored, not built in CI

Adding the .NET SDK + `wasm-tools` to every build/CI host (RAM-bound) is a far
larger, slower dependency than committing the prebuilt artifact. The runtime
contract is stable (the `Eval` signature above), so the bundle only changes when
the .NET version or the eval host is intentionally updated.
