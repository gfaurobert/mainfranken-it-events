# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

FROM python:3.12-slim

RUN pip install --no-cache-dir uv==0.8.13

WORKDIR /code

COPY ./pyproject.toml ./README.md ./uv.lock* ./

COPY ./app ./app
COPY ./ingest ./ingest

# Headless-Browser-Stack für den Ingest-Agent (fetch_rendered rendert JS-lastige
# Quellen). Das [headless]-Extra zieht playwright; `playwright install --with-deps`
# holt Chromium samt System-Bibliotheken. Ohne diesen Schritt fallen headless-
# Quellen zur Laufzeit sauber auf 0 Events zurück (FetchError-Soft-Skip).
RUN uv sync --frozen --extra headless \
 && uv run playwright install --with-deps chromium

ARG COMMIT_SHA=""
ENV COMMIT_SHA=${COMMIT_SHA}

ARG AGENT_VERSION=0.0.0
ENV AGENT_VERSION=${AGENT_VERSION}

EXPOSE 8080

CMD ["uv", "run", "uvicorn", "app.fast_api_app:app", "--host", "0.0.0.0", "--port", "8080"]