from ingest.registry.loader import load_sources


def test_loads_only_active(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text(
        "sources:\n"
        "  - name: A\n    url: https://a/x.ics\n    type: ical\n    region: Würzburg\n    active: true\n"
        "  - name: B\n    url: https://b\n    type: html\n    region: Schweinfurt\n    active: false\n"
    )
    active = load_sources(str(p), only_active=True)
    assert [s.name for s in active] == ["A"]
    all_ = load_sources(str(p), only_active=False)
    assert len(all_) == 2


def test_default_registry_parses():
    srcs = load_sources(only_active=False)
    assert len(srcs) >= 4
    assert all(s.type in {"ical", "jsonld", "confstech", "html", "aiweek"} for s in srcs)
