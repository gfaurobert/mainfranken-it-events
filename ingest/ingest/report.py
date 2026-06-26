def build_report(sources: int, raw: int, deduped: int, written: int, errors: int) -> dict:
    return {"sources": sources, "raw": raw, "deduped": deduped,
            "written": written, "errors": errors}
