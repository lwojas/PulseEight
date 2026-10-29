cmake_minimum_required(VERSION 3.22)
project(Pulse8VST VERSION 0.1.0 LANGUAGES C CXX)

# Optional, local-only VST3 build of Pulse.8. Not part of `npm run build` or CI: run `npm run vst:build`.
#
# The plugin is the webvst host (https://github.com/lwojas/webvst: a JUCE WebView that fakes Web Audio for the page and
# runs webdsp's native engine on the DAW's audio thread) with Pulse.8 as its client. webvst is a sibling checkout, like
# webdsp, and none of its sources are copied here: this file only declares one more plugin from them, the way webvst's own
# CMakeLists does for WebSeq and WebTracker. See docs/dev/vst.md.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PULSE8_WEBVST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../webvst" CACHE PATH "Path to a webvst checkout")
# The engine the page is built against (package.json: "webdsp": "file:../webdsp"), so page and plugin agree.
set(PULSE8_WEBDSP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../webdsp" CACHE PATH "Path to a webdsp checkout")
cmake_path(NORMAL_PATH PULSE8_WEBVST_DIR)
cmake_path(NORMAL_PATH PULSE8_WEBDSP_DIR)

if(NOT EXISTS "${PULSE8_WEBVST_DIR}/src/PluginEditor.cpp")
  message(FATAL_ERROR "webvst not found at ${PULSE8_WEBVST_DIR}. Clone it beside Pulse8 (git clone https://github.com/lwojas/webvst ../webvst) or pass -DPULSE8_WEBVST_DIR=<path>")
endif()
if(NOT EXISTS "${PULSE8_WEBDSP_DIR}/native/src/engine.h")
  message(FATAL_ERROR "webdsp not found at ${PULSE8_WEBDSP_DIR}. Clone it beside Pulse8 (git clone https://github.com/lwojas/webdsp ../webdsp) or pass -DPULSE8_WEBDSP_DIR=<path>")
endif()

# JUCE: the same version webvst pins. A webvst build that already fetched it is reused (no download, works offline).
include(FetchContent)
if(NOT DEFINED FETCHCONTENT_SOURCE_DIR_JUCE AND EXISTS "${PULSE8_WEBVST_DIR}/build/_deps/juce-src/CMakeLists.txt")
  set(FETCHCONTENT_SOURCE_DIR_JUCE "${PULSE8_WEBVST_DIR}/build/_deps/juce-src")
  message(STATUS "Reusing JUCE from ${FETCHCONTENT_SOURCE_DIR_JUCE}")
endif()
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 9.0.4
  GIT_SHALLOW ON)
FetchContent_MakeAvailable(JUCE)

# The page shim is a real .js file, embedded as BinaryData::shim_js.
juce_add_binary_data(WebVstData SOURCES "${PULSE8_WEBVST_DIR}/src/shim.js")

# The page this plugin opens. Default: the Pulse.8 dev server (`npm run dev`, or `npm run vst:serve` for the production
# build), port 5175 as in vite.config.ts. Override per run in the DAW's environment: WEBVST_URL_PULSE8 (or WEBVST_URL).
set(PULSE8_DEFAULT_URL "http://localhost:5175/" CACHE STRING "URL the plugin editor loads by default")

juce_add_plugin(Pulse8
  PRODUCT_NAME "Pulse8"
  COMPANY_NAME "lwojas"
  PLUGIN_MANUFACTURER_CODE Lwjs
  PLUGIN_CODE Pls8
  FORMATS VST3
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  NEEDS_WEB_BROWSER TRUE
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(Pulse8 PRIVATE
  "${PULSE8_WEBVST_DIR}/src/EngineHost.cpp"
  "${PULSE8_WEBVST_DIR}/src/SessionState.cpp"
  "${PULSE8_WEBVST_DIR}/src/HostFiles.cpp"
  "${PULSE8_WEBVST_DIR}/src/PluginProcessor.cpp"
  "${PULSE8_WEBVST_DIR}/src/PluginEditor.cpp")

target_include_directories(Pulse8 PRIVATE "${PULSE8_WEBVST_DIR}/src")
target_include_directories(Pulse8 SYSTEM PRIVATE "${PULSE8_WEBDSP_DIR}/native/src")

# WEBVST_APP_ID stamps the saved state: this plugin refuses another app's state (and the other way round).
target_compile_definitions(Pulse8 PUBLIC
  WEBVST_APP_ID="pulse8"
  WEBVST_DEFAULT_URL="${PULSE8_DEFAULT_URL}"
  JUCE_WEB_BROWSER=1
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(Pulse8 PRIVATE
  WebVstData
  juce::juce_audio_utils
  juce::juce_gui_extra
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

# macOS: a CLEAN build leaves the bundle with a broken code signature (JUCE signs it, then writes
# Contents/Resources/moduleinfo.json), which Ableton Live's scanner refuses silently. Re-sign the finished bundle as the
# very last step, ad hoc (enough to load on this machine). Same fix as webvst's CMakeLists.txt.
if(APPLE)
  add_custom_command(TARGET Pulse8_VST3 POST_BUILD
    COMMAND codesign --force --sign - --timestamp=none "$<GENEX_EVAL:$<TARGET_PROPERTY:Pulse8_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
    COMMAND codesign --verify --strict "$<GENEX_EVAL:$<TARGET_PROPERTY:Pulse8_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
    COMMENT "Signing Pulse8.vst3 (after moduleinfo.json was added)"
    VERBATIM)
endif()

# Headless end-to-end test (opt-in): the real EngineHost behind a stdin/stdout harness, driven by vst/test/e2e.test.ts, which runs the
# page's own code (Groovebox, controller, MIDI) through webvst's shim. `npm run vst:e2e`.
option(PULSE8_BUILD_E2E "Build the headless end-to-end harness" OFF)
if(PULSE8_BUILD_E2E)
  juce_add_console_app(Pulse8Harness PRODUCT_NAME "Pulse8Harness")
  target_sources(Pulse8Harness PRIVATE
    test/harness.cpp
    "${PULSE8_WEBVST_DIR}/src/EngineHost.cpp"
    "${PULSE8_WEBVST_DIR}/src/SessionState.cpp"
    "${PULSE8_WEBVST_DIR}/src/HostFiles.cpp")
  target_include_directories(Pulse8Harness PRIVATE "${PULSE8_WEBVST_DIR}/src")
  target_include_directories(Pulse8Harness SYSTEM PRIVATE "${PULSE8_WEBDSP_DIR}/native/src")
  target_link_libraries(Pulse8Harness PRIVATE
    juce::juce_core juce::juce_events juce::juce_audio_basics
    PUBLIC juce::juce_recommended_config_flags)
endif()
