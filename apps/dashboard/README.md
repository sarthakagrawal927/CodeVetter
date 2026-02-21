# Dashboard App (Local Control Plane)

This dashboard is now a working local frontend for the v1 skeleton backend.

Current capabilities:

- Configure API base URL and optional auth token.
- Configure optional GitHub App install URL and open install flow.
- Create/list organizations.
- Create/list org members.
- Proper one-click GitHub App connect for repositories (`owner/repo` or GitHub URL) with installation ID validation.
- Create/list repositories.
- Load/update repository rules.
- Trigger/list review runs.
- Run drift checks and queue reconcile runs.
- Simulate GitHub webhook events and inspect recorded events.

Run locally:

```bash
cd /Users/sarthakagrawal/Desktop/code-reviewer/apps/dashboard
python3 -m http.server 4174
```

Then open: `http://localhost:4174`
