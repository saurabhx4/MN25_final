from __future__ import annotations
import hashlib, json, os, pathlib, subprocess, sys
from datetime import datetime, timezone
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "data"

def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')

def sha256(path: pathlib.Path, chunk=1024*1024) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        while True:
            b=f.read(chunk)
            if not b: break
            h.update(b)
    return h.hexdigest()

def write_json(path: pathlib.Path, obj: Any):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False)+"\n", encoding='utf-8')

def load_yaml(path: pathlib.Path):
    import yaml
    return yaml.safe_load(path.read_text(encoding='utf-8'))

def require_file(path: pathlib.Path, label: str):
    if not path.exists():
        raise FileNotFoundError(f"{label}: {path}")

def manifest_for(path: pathlib.Path, **meta):
    return {"path": str(path.relative_to(ROOT)), "checksum": sha256(path), "created_at": utcnow(), **meta}
