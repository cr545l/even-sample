cmake_minimum_required(VERSION 3.20)

# Build and Run owns the shared server, logs, and session cleanup implementation.
# Optional LAN override: -DG2_HOST=192.168.0.101 or EVEN_G2_HOST environment variable.
set(EVEN_TARGET "G2")
set(EVEN_PORT 5174)
include("${CMAKE_CURRENT_LIST_DIR}/Build and Run.cmake")
