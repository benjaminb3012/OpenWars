# Render setup — Arena.ai Agent Mode

Date: 2026-11-13

## Status

- Render skills: installed (22) in `/home/user/.agents/skills/`.
- Render MCP connector in Arena: unsupported (`list_connector_tools("render")` returned `unsupported`).
- Authentication: API key mode required for this generic/non-interactive environment.
- Verification: `list_workspaces` succeeded through the fallback client on 2026-11-13.
- Workspace discovered: `Benjamin's workspace` (`tea-dbrg5blckfvc73e682n0`). Only one workspace was returned.
- Secret handling: no API key was written to workspace files. The key shared in chat was revoked by the user on 2026-11-13.
- Current persistent environment: `RENDER_API_KEY` is not stored in the workspace. The Render connection is therefore inactive until a new key is securely injected.

## Files

- `/home/user/render-setup/mcp.render.json` — portable MCP client configuration using `mcp-remote`. It contains only an environment-variable reference, never a secret.
- `/home/user/render-setup/render-mcp.mjs` — minimal MCP fallback client. It can call Render MCP tools directly over HTTPS once `RENDER_API_KEY` is set.
- `/home/user/.agents/skills/` — canonical Render skills copy. Arena does not auto-load these skills; they can be read manually or used by a compatible local coding agent.

## Human step: rotate the exposed key, then provide a new key securely

The previous key was pasted into chat. Treat it as compromised.

1. Revoke/delete that key in Render: https://dashboard.render.com/u/settings#api-keys
2. Create a replacement key.
3. Set `RENDER_API_KEY` in the environment read by the agent process. Do not paste the new key into chat and do not commit it.
4. Restart/reload the agent process if it was already running.

For a local interactive shell, one safe pattern is:

```sh
read -rs RENDER_API_KEY
export RENDER_API_KEY
```

For CI or a hosted agent, inject `RENDER_API_KEY` through the platform's secret/environment mechanism.

## Verify

```sh
node /home/user/render-setup/render-mcp.mjs list_workspaces '{}'
```

A successful `list_workspaces` response is the definition of done. If multiple workspaces are returned, choose the intended workspace explicitly before any resource operation.

## Use with a compatible local MCP client

Merge the `render` entry from `mcp.render.json` into the client's MCP configuration, ensure `RENDER_API_KEY` is in the client process environment, then restart the client. Do not replace unrelated MCP servers.

## Notes

- The hosted endpoint is `https://mcp.render.com/mcp`.
- OAuth is preferred where a supported client documents it, but this generic Arena path uses an API key.
- API keys do not expire like OAuth sessions; OAuth re-authorization is expected when a previously working OAuth connection returns 401.
- No Render resource was created, modified, or deployed during setup.
