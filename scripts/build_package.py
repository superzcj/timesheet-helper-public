#!/usr/bin/env python3
"""Create the cross-platform unpacked-extension download without repository metadata."""
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
output = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "dist" / f"timesheet-helper-v{version}.zip"
files = ["manifest.json", "core.js", "api.js", "runner.js", "content.js", "workdays.json", "INSTALL.html", "README.md", "CALENDAR.md"]
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, f"timesheet-helper/{name}")
print(output.resolve())
