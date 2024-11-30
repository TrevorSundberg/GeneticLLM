FROM ghcr.io/webassembly/wasi-sdk:sha-3866d29

RUN apt-get update && apt-get install -y \
    curl \
    dumb-init \
    xz-utils

RUN curl https://wasmtime.dev/install.sh -sSf | bash

ENV PATH="/root/.wasmtime/bin/:$PATH"
ENV WASMTIME_BACKTRACE_DETAILS=1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
