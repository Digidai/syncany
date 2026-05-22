# @raltic/sandbox-container

Per-Agent CF Container lifecycle wrapper. One instance per Agent;
container holds the agent's `/workspace` and runs `@raltic/sandbox-daemon`
on port 8080.

## Wiring

Built into apps/api Worker via:

```jsonc
// apps/api/wrangler.jsonc
{
  "containers": [
    {
      "class_name": "SandboxContainer",
      "image": "./packages/sandbox-image/Dockerfile",
      "max_instances": 1000,
      "instance_type": "basic"
    }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "SANDBOX", "class_name": "SandboxContainer" }
    ]
  },
  "migrations": [
    { "tag": "v3", "new_sqlite_classes": ["SandboxContainer"] }
  ]
}
```

## Cost

- Idle: $0 (sleep-on-idle after 5 min)
- Active (1 GB RAM): ~$0.06/hour
- Typical agent at 10% active utilization: ~$15/month
