"""Only app/repository may import SQL or the DB driver."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
FORBIDDEN = ("sqlalchemy", "psycopg", "alembic")


def test_no_db_imports_outside_repository() -> None:
    offenders = []
    for path in APP.rglob("*.py"):
        if "repository" in path.relative_to(APP).parts:
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            offenders += [f"{path.relative_to(APP)}: {n}" for n in names if n.split(".")[0] in FORBIDDEN]
    assert offenders == []
