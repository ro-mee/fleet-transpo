---
type: development
status: installed-restart-required
last_verified: 2026-10-21
related: ["[[Mobile Architecture]]"]
---

# REA Codex integration - 2026-10-21

The owner requested adding REA (Reverse Engineer Anything) to this Codex environment. Installed the official `rea-agents` release 6.7.0 from npm, whose repository metadata points to `morluto/rea`. This is developer tooling, not a FleetOps application dependency.

## Configuration

Ran the official scoped setup preview, then applied `setup --client codex --yes --json`. Setup reported `ready`, `configured_codex`, `installed_skill`, and healthy scoped diagnostics. No other agent clients or analysis engines were selected.

- Codex registration: `C:/Users/lenovo/.codex/config.toml`, under `[mcp_servers.rea]`.
- Windows command: `cmd.exe /d /c npx -y rea-agents@6.7.0 mcp`.
- Startup timeout 30 seconds; tool timeout 450 seconds, as chosen by REA setup.
- Matching workflow: `C:/Users/lenovo/.agents/skills/reverse-engineer-anything/SKILL.md` and its on-demand references.
- Setup recovery copy: `C:/Users/lenovo/.codex/config.toml.rea.backup`.

Compared the parsed Codex configuration before and after setup, excluding only the new REA registration. Its SHA-256 comparison matched, confirming the existing settings and other MCP configuration were preserved. `codex mcp get rea --json` confirmed the enabled stdio registration.

## Executed verification

Established an actual local MCP connection using the registered Windows command. The initialize response identified `rea` version 6.7.0; `tools/list` returned 207 tools. This verifies the server starts and exposes its catalog, not that every optional provider is installed.

Called the advertised `analyze_javascript_application` tool on a tiny fictional package created solely under `scratch/rea-integration/sample-app`. It returned structured static-analysis Evidence with an artifact digest and derived summary. The sample was parsed as inert text; neither the sample nor FleetOps application code was executed. The probe saved its connection/catalog/sample evidence under ignored `scratch/rea-integration/`.

Native binary/APK analysis remains conditional on separate provider setup. Diagnostics found no configured Ghidra, IDA, JADX or Kuna engine. None was installed, licensed or activated as part of this request. Static JavaScript analysis was verified independently of those engines.

## Activation and use

Restart Codex to load the new server and skill into fresh chat sessions. The current chat's already-created tool catalog is not proof of post-restart availability. After restarting, a matching REA tool call can verify activation in Codex itself.

Use REA for shipped apps/packages, binaries and behavior that cannot be established from source. Use normal repository tools for ordinary FleetOps source-code work, as the installed workflow instructs. No application dependency, product UI, database, production provider, deployment, push or unrelated working-tree change was part of this integration.

Sources: https://github.com/morluto/rea ; https://github.com/morluto/rea/blob/main/docs/installation.md ; https://learn.chatgpt.com/docs/extend/mcp?surface=cli .
