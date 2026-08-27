# Surge Ulti Panels v1

Experimental native Surge 5 iOS information panels. This build is isolated from the existing dashboard v3 files.

## One-tap test

Import this module URL in Surge:

`https://raw.githubusercontent.com/Madsmydahl99/Mads-Network-Dashboard/main/ulti-panels/v1/Surge-Ulti-Panels-v1.sgmodule`

## Panels

- Change Correlator — compares state snapshots and recent error evidence.
- Route Drift — detects observed host → policy changes across refreshes.
- DNS Lens — DNS delay, resolver count, and cache evidence.
- Latency Radar — policy-bound HTTP probe latency for Work / AI / Media.
- Rule Heatmap — ranks recent rule matches; falls back to policy distribution when rule fields are unavailable.
- Connection DNA — local network fingerprint history.
- Failover Brain — compares two policy candidates with HTTP probes; does not claim access to Surge's hidden selection reasoning.
- Quiet Network — ranks recent host chatter; not guaranteed to represent true device-idle traffic.

## Default policy names

The module ships with `Work`, `AI`, and `Streaming`, plus `FAILOVER_A=Work` and `FAILOVER_B=AI`. Change the `[Script]` argument if your policy groups use different names. URL-encode spaces or special characters.

## Safety

Read-only. No DNS flushes, policy changes, rule edits, profile reloads, request kills, or module toggles. Persistent storage is used only for local comparison baselines.

## First refresh

Change Correlator, Route Drift, and Connection DNA become more useful after a second refresh because the first run establishes a baseline.
