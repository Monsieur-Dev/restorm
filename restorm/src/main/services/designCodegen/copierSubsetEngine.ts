/**
 * The sandboxed template engine — a COPIER-FORMAT subset implemented on
 * jinja2 + pyyaml, executed inside Pyodide's MEMFS (see
 * {@link ./DesignCodegenService}). Templates stay genuine Copier
 * templates (`copier.yml` + `.jinja` suffixes — the official repos' CI
 * runs them through REAL Copier), while the in-app run needs neither
 * pydantic-core nor pygit2 (both native extensions Pyodide can't load
 * from PyPI wheels).
 *
 * Supported Copier surface (documented in
 * docs/contributing/adding-a-code-template.md):
 *   - top-level questions with literal `default` values (answers
 *     provided by the app override them);
 *   - `_subdirectory`, `_templates_suffix` (default `.jinja`),
 *     `_exclude` (fnmatch globs);
 *   - Jinja rendering of file CONTENTS (suffixed files) and of PATH
 *     segments (`{{ var }}` in file/dir names);
 *   - the design context is always available as `ctx` (Restorm
 *     convention, mirrored by the official templates' CI answers file);
 *   - optional sandboxed hooks `hooks/pre_gen.py` / `hooks/post_gen.py`
 *     exec'd with `ctx` / `answers` / `output_root` globals — they run
 *     INSIDE the MEMFS sandbox, so an escape attempt fails cleanly.
 * Refused with a clear error: `_tasks` and `_migrations` (they demand a
 * real shell, which the sandbox deliberately does not have).
 *
 * Contract with the worker (`PYODIDE_WORKER_SRC`): `input` carries
 * `{ files: [{path, b64}], context, answers }`; the LAST EXPRESSION is
 * the result — `{ files: [{path, b64}], log: [...] }`, every path
 * RELATIVE to the (virtual) output root.
 */

export const COPIER_SUBSET_ENGINE_PY = `
import base64
import fnmatch
import json
import posixpath

import sys

# CC1 — defense in depth over the codegen worker's empty jsglobals
# (the REAL barrier: the invited code's js module is a frozen empty
# object at the runtime level, unrestorable by a hook that clears
# sys.modules and re-imports). This poisoning just makes a DIRECT
# import js fail fast on the happy path; codegenWorker.ts is where the
# load-bearing guarantee lives.
sys.modules['js'] = None
sys.modules['pyodide_js'] = None

import yaml
from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment

TEMPLATE_ROOT = "/restorm-template"
OUTPUT_ROOT = "/restorm-out"

ENGINE_FILES = {"copier.yml", "copier.yaml", "restorm-template.json"}


def fail(message):
    raise RuntimeError("template error: " + message)


def write_template_files(files):
    import os
    for entry in files:
        path = entry["path"]
        if path.startswith("/") or ".." in path.split("/"):
            fail("template archive carries an unsafe path: " + path)
        target = posixpath.join(TEMPLATE_ROOT, path)
        os.makedirs(posixpath.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(base64.b64decode(entry["b64"]))


def load_copier_config():
    import os
    for name in ("copier.yml", "copier.yaml"):
        path = posixpath.join(TEMPLATE_ROOT, name)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            if not isinstance(data, dict):
                fail(name + " must be a mapping")
            return data
    return {}


def collect_answers(config, provided, ctx):
    answers = {}
    for key, spec in config.items():
        if key.startswith("_"):
            continue
        if isinstance(spec, dict):
            if "default" in spec:
                answers[key] = spec["default"]
        else:
            answers[key] = spec
    for key, value in (provided or {}).items():
        answers[key] = value
    answers["ctx"] = ctx
    return answers


def run_hook(name, answers, ctx, log):
    import os
    path = posixpath.join(TEMPLATE_ROOT, "hooks", name)
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()
    scope = {"ctx": ctx, "answers": answers, "output_root": OUTPUT_ROOT}
    try:
        exec(compile(source, name, "exec"), scope)
    except Exception as e:  # noqa: BLE001 — surfaced as a clean template error
        fail("hook " + name + " failed: " + str(e))
    log.append("hook " + name + " ran")


def generate(input_data):
    import os

    files = input_data.get("files") or []
    ctx = input_data.get("context") or {}
    provided = input_data.get("answers") or {}
    log = []

    write_template_files(files)
    config = load_copier_config()

    for forbidden in ("_tasks", "_migrations"):
        if forbidden in config:
            fail(forbidden + " is not supported: the sandbox has no shell. Move the logic into the template or a sandboxed hook.")

    suffix = config.get("_templates_suffix", ".jinja")
    subdirectory = config.get("_subdirectory", "")
    excludes = config.get("_exclude") or []
    if not isinstance(excludes, list):
        fail("_exclude must be a list of globs")

    answers = collect_answers(config, provided, ctx)
    # SANDBOXED environment (CC1): attribute traversal from a template
    # expression is refused — real Copier sandboxes too. Whitespace
    # settings mirror what real Copier's CI output showed EMPIRICALLY
    # (no trim_blocks/lstrip_blocks), so both engines render the same
    # bytes and the official repos' goldens hold for both.
    env = SandboxedEnvironment(undefined=StrictUndefined, keep_trailing_newline=True)

    def render_text(text, what):
        try:
            return env.from_string(text).render(**answers)
        except Exception as e:  # noqa: BLE001
            fail("rendering " + what + ": " + str(e))

    root = posixpath.join(TEMPLATE_ROOT, subdirectory) if subdirectory else TEMPLATE_ROOT
    if not os.path.isdir(root):
        fail("_subdirectory points nowhere: " + str(subdirectory))

    os.makedirs(OUTPUT_ROOT, exist_ok=True)
    run_hook("pre_gen.py", answers, ctx, log)

    produced = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for filename in sorted(filenames):
            source = posixpath.join(dirpath, filename)
            rel = posixpath.relpath(source, root)
            if root == TEMPLATE_ROOT:
                top = rel.split("/")[0]
                if rel in ENGINE_FILES or top == "hooks" or top.startswith(".git"):
                    continue
            if any(fnmatch.fnmatch(rel, pattern) for pattern in excludes):
                continue

            rendered_rel = render_text(rel, "path " + rel)
            if rendered_rel.strip() == "" or rendered_rel.startswith("/") or ".." in rendered_rel.split("/"):
                fail("path " + rel + " rendered to an unsafe target: " + rendered_rel)

            if filename.endswith(suffix):
                with open(source, "r", encoding="utf-8") as f:
                    content = render_text(f.read(), rel).encode("utf-8")
                rendered_rel = rendered_rel[: -len(suffix)]
            else:
                with open(source, "rb") as f:
                    content = f.read()

            target = posixpath.join(OUTPUT_ROOT, rendered_rel)
            os.makedirs(posixpath.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(content)
            produced.append(rendered_rel)

    run_hook("post_gen.py", answers, ctx, log)

    # Copier-compatible answers file: record the questions' answers (never the
    # injected ctx answer nor _-prefixed meta) into the output tree, so
    # re-opening / re-generating into the same folder — and the real copier
    # tool — can reload them. Only written when the template actually asks
    # something, so a question-less template keeps a clean tree (goldens hold).
    recorded = {k: v for k, v in answers.items() if k != "ctx" and not str(k).startswith("_")}
    if recorded:
        answers_path = posixpath.join(OUTPUT_ROOT, ".copier-answers.yml")
        with open(answers_path, "w", encoding="utf-8") as f:
            f.write("# Changes here will be overwritten by a re-generation." + chr(10))
            yaml.safe_dump(recorded, f, default_flow_style=False, sort_keys=True, allow_unicode=True)
        log.append("wrote .copier-answers.yml")

    out = []
    for dirpath, _dirnames, filenames in os.walk(OUTPUT_ROOT):
        for filename in sorted(filenames):
            path = posixpath.join(dirpath, filename)
            rel = posixpath.relpath(path, OUTPUT_ROOT)
            with open(path, "rb") as f:
                out.append({"path": rel, "b64": base64.b64encode(f.read()).decode("ascii")})
    log.append("generated " + str(len(out)) + " file(s)")
    return {"files": out, "log": log}


result = generate(input.to_py() if hasattr(input, "to_py") else input)
json.loads(json.dumps(result))
`
