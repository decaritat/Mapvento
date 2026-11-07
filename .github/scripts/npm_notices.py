#!/usr/bin/env python3
"""Generate the npm part of THIRD-PARTY-NOTICES.md.

Reads the production dependency closure from package-lock.json (entries
without "dev": true), takes the license texts from node_modules and fails on
licenses outside the allowlist or on packages without a license text.
Run `npm ci` first. Usage: npm_notices.py <output.md>
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ALLOWED = {
    "MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0",
    "MPL-2.0", "0BSD", "Zlib", "CC0-1.0", "Unlicense", "BlueOak-1.0.0",
    "GPL-3.0-or-later",  # Mapvento itself
}
LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|notice)([-._].*)?$", re.I)


def tokenize(expr):
    return re.findall(r"\(|\)|[^\s()]+", expr)


def allowed(tokens):
    """Evaluate an SPDX expression; OR needs one, AND needs all allowed."""
    def parse_or(i):
        ok, i = parse_and(i)
        while i < len(tokens) and tokens[i] == "OR":
            rhs, i = parse_and(i + 1)
            ok = ok or rhs
        return ok, i

    def parse_and(i):
        ok, i = parse_atom(i)
        while i < len(tokens) and tokens[i] == "AND":
            rhs, i = parse_atom(i + 1)
            ok = ok and rhs
        return ok, i

    def parse_atom(i):
        if tokens[i] == "(":
            ok, i = parse_or(i + 1)
            return ok, i + 1
        return tokens[i] in ALLOWED, i + 1

    ok, end = parse_or(0)
    return ok and end == len(tokens)


def main():
    out = Path(sys.argv[1])
    lock = json.loads(Path("package-lock.json").read_text(encoding="utf-8"))
    packages = []
    errors = []
    for path, info in sorted(lock["packages"].items()):
        if not path or info.get("dev") or info.get("link"):
            continue
        pkg_dir = Path(path)
        name = info.get("name") or path.split("node_modules/")[-1]
        meta_file = pkg_dir / "package.json"
        meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
        lic = info.get("license") or meta.get("license")
        if isinstance(lic, dict):
            lic = lic.get("type")
        if not lic or not allowed(tokenize(str(lic))):
            errors.append(f"{name}@{info.get('version')}: license '{lic}' is unknown or not allowed")
            continue
        texts = sorted(
            f for f in pkg_dir.iterdir()
            if f.is_file() and LICENSE_FILE.match(f.name)
        ) if pkg_dir.is_dir() else []
        text = "\n\n".join(f.read_text(encoding="utf-8", errors="replace").strip() for f in texts)
        if not text:
            errors.append(f"{name}@{info.get('version')}: no license text found in {pkg_dir}")
            continue
        repo = meta.get("repository")
        repo = repo.get("url") if isinstance(repo, dict) else repo
        copyright_lines = sorted({
            line.strip() for line in text.splitlines()
            if re.match(r"\s*(copyright\s*(\(c\)|©|\d)|\(c\)\s*\d|©)", line, re.I)
        })
        packages.append({
            "name": name, "version": info.get("version", ""), "license": lic,
            "origin": info.get("resolved", ""), "repository": repo or "",
            "copyright": copyright_lines, "text": text,
        })

    if errors:
        print("npm license check failed:", *errors, sep="\n  ", file=sys.stderr)
        sys.exit(1)

    by_text = {}
    for p in packages:
        by_text.setdefault(hashlib.sha256(p["text"].encode()).hexdigest(), []).append(p)

    lines = ["## npm packages (frontend)", "",
             "Production dependencies including transitive ones, taken from `package-lock.json`.", ""]
    for p in packages:
        lines.append(f"### {p['name']} {p['version']}")
        lines.append(f"- License: {p['license']}")
        lines.append(f"- Origin: {p['origin']}")
        if p["repository"]:
            lines.append(f"- Repository: {p['repository']}")
        lines.extend(f"- {c}" for c in p["copyright"]) if p["copyright"] else lines.append("- Copyright: see license text")
        lines.append("")
    lines += ["## npm license texts", ""]
    for group in by_text.values():
        lines.append("### " + ", ".join(f"{p['name']} {p['version']}" for p in group))
        lines += ["", "```text", group[0]["text"], "```", ""]
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(packages)} npm packages to {out}")


if __name__ == "__main__":
    main()
