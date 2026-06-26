from pathlib import Path
import yaml
from ingest.models import SourceConfig

_DEFAULT = Path(__file__).parent / "sources.yaml"


def load_sources(path: str | None = None, only_active: bool = True) -> list[SourceConfig]:
    data = yaml.safe_load(Path(path or _DEFAULT).read_text(encoding="utf-8"))
    sources = [SourceConfig(**item) for item in data.get("sources", [])]
    if only_active:
        sources = [s for s in sources if s.active]
    return sources
