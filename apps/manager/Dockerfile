# syntax=docker/dockerfile:1.7

# ── builder ───────────────────────────────────────────────────────
FROM python:3.12-slim AS builder
WORKDIR /build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

# 拷入完整仓库（monorepo）；Manager 实现在 apps/manager/sop_manager/
COPY . /build

# 安装 manager + 常用可选项（生产推荐 postgres/redis/otel/llm）
RUN pip install \
    "/build/apps/manager[postgres,redis,otel,llm,embeddings,pdf,vector-qdrant,vector-lance]"

# ── runtime ───────────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PROJECT_PATH=/workspace \
    ADMIN_MODE=saas \
    PORT=8765

# 运行时复制最小集
COPY --from=builder /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . /app

RUN useradd -u 10001 -m sop && \
    mkdir -p /workspace /var/lib/sop-runtime && \
    chown -R sop:sop /workspace /var/lib/sop-runtime /app

USER sop
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:${PORT}/api/v1/health',timeout=3).status==200 else 1)"

ENTRYPOINT ["sop-manager"]
CMD ["start", "--host", "0.0.0.0", "--port", "8765"]
