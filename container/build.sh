#!/bin/bash
# Build the NanoClaw agent container image
# Uses Docker (OrbStack) on macOS < 26, Apple Container on macOS >= 26

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"

# Detect container runtime: prefer Apple Container, fall back to Docker
if command -v container &>/dev/null; then
  RUNTIME="container"
elif command -v docker &>/dev/null; then
  RUNTIME="docker"
elif [ -x "$HOME/.orbstack/bin/docker" ]; then
  export PATH="$HOME/.orbstack/bin:$PATH"
  RUNTIME="docker"
else
  echo "Error: No container runtime found. Install Docker (OrbStack) or Apple Container."
  exit 1
fi

echo "Building NanoClaw agent container image..."
echo "Runtime: ${RUNTIME}"
echo "Image: ${IMAGE_NAME}:${TAG}"

$RUNTIME build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Runtime: ${RUNTIME}"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"channelId\":\"123456789\",\"isMain\":false}' | $RUNTIME run -i ${IMAGE_NAME}:${TAG}"
