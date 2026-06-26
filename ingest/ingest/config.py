import os
from dataclasses import dataclass
from functools import lru_cache
from google.adk.models.lite_llm import LiteLlm


@dataclass(frozen=True)
class Settings:
    opencode_key: str
    opencode_base_url: str
    opencode_model: str
    supabase_url: str
    supabase_service_key: str
    sink: str


@lru_cache
def get_settings() -> Settings:
    return Settings(
        opencode_key=os.environ.get("OPENCODE_GO_KEY", ""),
        opencode_base_url=os.environ.get("OPENCODE_GO_BASE_URL", ""),
        opencode_model=os.environ.get("OPENCODE_GO_MODEL", "deep-v4-flash"),
        supabase_url=os.environ.get("SUPABASE_URL", ""),
        supabase_service_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        sink=os.environ.get("INGEST_SINK", "supabase"),
    )


def get_model() -> LiteLlm:
    s = get_settings()
    return LiteLlm(
        model=f"openai/{s.opencode_model}",
        api_base=s.opencode_base_url,
        api_key=s.opencode_key,
    )
