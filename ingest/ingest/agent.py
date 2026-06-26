from google.adk.workflow import Workflow
from ingest.pipeline import run_ingest


async def ingest_node(node_input) -> dict:
    return await run_ingest()


root_agent = Workflow(
    name="mainfranken_ingest",
    edges=[("START", ingest_node)],
)
