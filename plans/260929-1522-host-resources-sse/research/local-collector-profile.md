# Local collector evidence

Date: 2026-09-29. Planning-only measurement; no application implementation.

## Command and scope

```sh
bash scripts/profile-host-resource-deep-scan.sh 10 /home/loidinh/WS/dam-hopper
```

First invocation timed out during the vendored release build after 180 seconds; no sample results. Second invocation completed the build and ran the existing profiler successfully. The profiler invokes `collect_host_resource_snapshot_with_options(..., true, true, 150)` ten times: process inventory and PSS enabled on EVERY iteration, without production cadence sleeps. Source: `server/examples/host_resource_profile.rs:68-84`.

## Observed output

```json
{"iterations":10,"collectorCpuNanosTotal":470753849,"collectorCpuNanosPeak":48261884,"collectorWallNanosPeak":48568497,"rssBeforeBytes":2187264,"rssAfterBytes":2846720,"retainedRssDeltaBytes":659456,"snapshotBytesPeak":7505,"scannedProcessesPeak":518,"deadlineExceededSamples":0}
```

- Mean deep-collector CPU: 47.075 ms/iteration.
- Peak deep-collector CPU: 48.262 ms; peak wall time: 48.568 ms.
- Peak scanned processes: 518; process deadline exceeded: 0/10.
- Peak serialized deep snapshot: 7,505 bytes (NOT combined SSE frame).
- Retained RSS delta: 659,456 bytes (~644 KiB). Ten iterations cannot establish a leak trend.

## Interpretation limits

- This is one development Linux host, not deployment qualification or a load test.
- CPU timing excludes snapshot JSON serialization, legacy `HostMetricsSampler`, alert classification, SSE framing/delivery, session-policy database lookups, browsers, and network/proxy overhead.
- [INFERENCE] Repeating this measured full scan once per five seconds would average ~0.942% of one CPU core. Production skips process/PSS work between their cadences; actual whole-monitor overhead must be measured rather than inferred from this estimate.
- [INFERENCE] 7,505-byte snapshots sent every five seconds to 32 clients would carry ~48,032 bytes/s of snapshot payload. Actual combined frame size and protocol overhead are additional; subscriber count must not multiply collection work.
- No credentials, real host actions, configuration changes, or existing services were used.

## Unresolved questions

Representative weak-host CPU/IO cost, blocked mount behavior, whole-monitor CPU, SSE fanout and authentication costs remain unmeasured. Implementation qualification must measure them with explicit budgets and isolated fixtures.
