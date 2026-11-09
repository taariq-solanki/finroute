FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app

# Configure UV for container environment
# Bytecode compilation disabled and cache disabled to minimize image size
# (a long-lived server compiles on first run; the .pyc duplication is not worth
# ~2x the package footprint, which pushes us over AgentCore's image size limit).
ENV UV_SYSTEM_PYTHON=1 UV_NO_CACHE=1



COPY requirements.txt requirements.txt
# Install from requirements file
RUN uv pip install --no-cache -r requirements.txt




RUN uv pip install --no-cache aws-opentelemetry-distro>=0.10.1


# Strip bytecode, caches, tests and dist-info bloat to shrink the image further
RUN find /usr/local/lib/python* /usr/lib/python* -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python* /usr/lib/python* -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true; \
    find /usr/local/lib/python* /usr/lib/python* -type d -name 'test' -prune -exec rm -rf {} + 2>/dev/null || true

# Set AWS region environment variable

ENV AWS_REGION=us-east-1
ENV AWS_DEFAULT_REGION=us-east-1


# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
EXPOSE 8000

# Copy entire project (respecting .dockerignore)
COPY . .

# Use the full module path

CMD ["opentelemetry-instrument", "python", "-m", "main"]
