#!/bin/bash
set -ex
docker buildx build --progress=plain -t genetic_llm/clang ./docker/wasm-wasi-sdk
