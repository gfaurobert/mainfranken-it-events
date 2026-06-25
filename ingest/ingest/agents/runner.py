import json
from google.adk.agents import LlmAgent
from google.adk.apps import App
from google.adk.runners import InMemoryRunner
from google.genai import types


def _structured_from_events(events) -> dict:
    """Extract structured JSON from a list of ADK events.

    Handles two delivery paths:
    - Chat-mode LlmAgent with output_schema (ADK 2.3): structured JSON is
      delivered as text in event.content.parts[].text on the final,
      non-partial response. event.output is always None on this path.
    - Workflow/task-mode path: event.output is already a parsed dict.

    Returns the parsed dict, or {} if no structured output is found.
    """
    result: dict = {}
    for event in events:
        # Workflow/task path: output is already a dict
        output = getattr(event, "output", None)
        if isinstance(output, dict):
            result = output
            continue

        # Chat-mode path: skip partial/streaming events
        partial = getattr(event, "partial", None)
        if partial:
            continue

        content = getattr(event, "content", None)
        if content is None:
            continue
        parts = getattr(content, "parts", None) or []
        text = "".join(
            p.text for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False)
        )
        if not text.strip():
            continue
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                result = parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return result


async def run_structured(agent: LlmAgent, prompt_text: str) -> dict:
    """Run an LlmAgent with output_schema once and return the last structured
    output dict, or {} if none was produced."""
    app = App(name=f"{agent.name}_app", root_agent=agent)
    runner = InMemoryRunner(app=app)
    session = await runner.session_service.create_session(
        app_name=app.name, user_id="ingest"
    )
    events = []
    async for event in runner.run_async(
        user_id="ingest",
        session_id=session.id,
        new_message=types.Content(
            role="user", parts=[types.Part.from_text(text=prompt_text)]
        ),
    ):
        events.append(event)
    return _structured_from_events(events)
