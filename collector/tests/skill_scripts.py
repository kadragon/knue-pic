"""The test home for ``.claude/skills/*/scripts/``.

Those scripts are the collector's stages, but they are not part of the
``collector`` package: they live beside the skill that documents them, so
``import`` cannot reach them and CI's ``python3 -m pytest collector`` would
otherwise cover none of them. Loading one by path from here puts it under the
same test run as the package, with no second pytest root and no change to
``ci.yml``.

Modules are cached because a script's import side effects — argparse setup at
module scope, a network client built eagerly — should run once per session, not
once per importing test file.
"""

from __future__ import annotations

import importlib.util
import pathlib
import types

_ROOT = pathlib.Path(__file__).resolve().parents[2]
_cache: dict[tuple[str, str], types.ModuleType] = {}


def skill_script_path(name: str, skill: str = "knue-expense-collect") -> pathlib.Path:
    """Absolute path of ``.claude/skills/<skill>/scripts/<name>.py``."""
    return _ROOT / ".claude" / "skills" / skill / "scripts" / f"{name}.py"


def load_skill_script(name: str, skill: str = "knue-expense-collect") -> types.ModuleType:
    """Import a skill script by path and return the module."""
    key = (skill, name)
    if key in _cache:
        return _cache[key]
    path = skill_script_path(name, skill)
    if not path.is_file():
        raise FileNotFoundError(f"no such skill script: {path}")
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None, f"unloadable skill script: {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _cache[key] = module
    return module
