# Installer Environment, Hooks, and Web UI Specification

Slug: `installer-environment-hooks-and-web-ui`. Source: `create-a-plan-to-pure-hedgehog-agent-add38afc34ffec7d9.md`.

## Problem Statement

Fresh installs needed discoverable Phase 0–8 configuration, passive-capture guidance without user-settings mutation, and one supported UI entry point.

## Requirements

- Fresh-install output and `.env.example` expose LLM, hooks, handoff, bootstrap, auto-improve, search, and Web UI settings.
- Existing `.env` files are preserved; generated values apply only to fresh/rebuilt installation output.
- Hook guidance is opt-in, prints configuration only, and must not overwrite `.claude/settings.json`.
- `/ui` is shown unless `WEB_UI_ENABLED=false` or `0`; standalone `dev:ui` scripts remain absent.

## Out of Scope

Changing Dockerfile’s stale `ui-client` comment, adding a second UI server, or claiming installer smoke coverage not found in the evidence.

## Verification Approach

Historical commits `f657a36` and `cd5c264`; deviations and absent shell/type-check smoke are recorded in `design.md`.
