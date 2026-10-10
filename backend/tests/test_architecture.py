"""Layering rules enforced on the source tree."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
DB_MODULES = ("sqlalchemy", "psycopg", "alembic")
HTTP_MODULES = ("httpx", "httpx2", "requests", "urllib", "http", "subprocess")
BCI_PACKAGE = "app.sources.blockchain_info"
COMPOSITION_ROOT = Path("ingestion/__main__.py")
# Strings that only the blockchain.info adapter may know: host and response-format keys.
BCI_MARKERS = ("blockchain.info", '"prev_out"', "'prev_out'", '"main_chain"', '"n_tx"', '"/block-height', "/blocks/")


def _imports(path: Path) -> list[str]:
    names = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
    return names


def _files(exclude_part: str):
    for path in APP.rglob("*.py"):
        rel = path.relative_to(APP)
        if exclude_part not in rel.as_posix():
            yield path, rel


def test_no_db_imports_outside_repository() -> None:
    offenders = [f"{rel}: {n}" for path, rel in _files("repository/") for n in _imports(path)
                 if n.split(".")[0] in DB_MODULES]
    assert offenders == []


def test_only_composition_root_imports_blockchain_info_adapter() -> None:
    offenders = [f"{rel}: {n}" for path, rel in _files("sources/blockchain_info/") for n in _imports(path)
                 if n.startswith(BCI_PACKAGE) and rel != COMPOSITION_ROOT]
    assert offenders == []


def test_no_blockchain_info_format_knowledge_outside_adapter() -> None:
    offenders = [f"{rel}: {m}" for path, rel in _files("sources/blockchain_info/") for m in BCI_MARKERS
                 if m in path.read_text()]
    assert offenders == []


def test_http_and_subprocess_only_inside_sources() -> None:
    offenders = [f"{rel}: {n}" for path, rel in _files("sources/") for n in _imports(path)
                 if n.split(".")[0] in HTTP_MODULES]
    assert offenders == []


def test_no_subprocess_anywhere_in_app() -> None:
    offenders = [f"{path.relative_to(APP)}" for path in APP.rglob("*.py") if "subprocess" in _imports(path)]
    assert offenders == []
