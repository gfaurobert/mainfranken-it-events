from google.adk.agents import LlmAgent
from google.adk.apps import App
from google.adk.runners import InMemoryRunner
from google.genai import types


async def run_structured(agent: LlmAgent, prompt_text: str) -> dict:
    """Run an LlmAgent with output_schema once and return the last structured
    output dict, or {} if none was produced."""
    app = App(name=f"{agent.name}_app", root_agent=agent)
    runner = InMemoryRunner(app=app)
    session = await runner.session_service.create_session(
        app_name=app.name, user_id="ingest"
    )
    result: dict = {}
    async for event in runner.run_async(
        user_id="ingest",
        session_id=session.id,
        new_message=types.Content(
            role="user", parts=[types.Part.from_text(text=prompt_text)]
        ),
    ):
        if getattr(event, "output", None) is not None and isinstance(event.output, dict):
            result = event.output
    return result
