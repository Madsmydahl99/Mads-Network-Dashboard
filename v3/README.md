# Mads Network Dashboard v3

A six-panel Surge iOS dashboard designed for readable, low-overhead network diagnostics.

## What each panel means

- **NETWORK** shows the active access network, LAN/gateway, public IPv4, locally resolved country/ASN/organization, IPv6 availability, and the current `DIRECT-SELECT` decision. A network-change event clears the old WAN cache so stale identity is not carried onto another Wi-Fi network.
- **CONNECTIVITY** measures end-to-end HTTP response time to four deliberately different endpoints. It is not ICMP ping: the displayed time includes DNS resolution, connection setup, TLS, and the server response. The Cloudflare and Apple endpoints also act as captive-portal canaries.
- **DNS** reads the current Surge DNS cache, observed resolvers, lookup delay, and network-provided DNS. Automatic evaluations are read-only. Only a manual panel refresh flushes the cache.
- **SPEED · MANUAL** runs only from a manual refresh. It transfers about 3 MiB total (2 MiB download and 1 MiB upload) and stores the last result. Its RTT/variation values come from five small HTTP probes and are not ICMP ping.
- **LIVE TRAFFIC** reads Surge's local `/v1/traffic` API. It shows current download/upload rates, totals since the Surge engine started, peak rates, and the selected interface. A manual refresh cycles interfaces when more than one is available. It sends no external network request.
- **CHANGE CORRELATOR** keeps a small, seven-day local timeline of network handoffs, gateway/DNS/IPv6 changes, Surge engine starts, relevant configuration notifications, reachability and web-RTT shifts. It compares before/after snapshots and labels the most defensible explanation: path-change coincidence, isolated remote-service trouble, captive portal, outage, or recovery. These are evidence-based hints, not claims of causation. Notification text is filtered but never retained.

The correlator probes Cloudflare and Apple captive-portal canaries plus the OpenAI API. Any HTTP response from OpenAI counts as reachable, including an expected unauthenticated response. The timeline is stored only in Surge's local persistent store, is capped at 12 entries, and expires entries after seven days.

## Safety boundary

The module contains only `[Panel]` and `[Script]` sections. It does not modify routing, proxies, DNS servers, IPv6 settings, rules, MITM, hosts, rewrites, modules, or policy groups. The correlator observes events and runs small HTTPS probes; it never applies automatic fixes.

## Upgrade

1. Install or update v3 and verify all six panels.
2. Disable both the earlier **Mads Network Dashboard** module and **Mads Network Dashboard v2** after v3 renders successfully.
3. This removes the obsolete **Sub Intelligence** panel because it belongs to the earlier module and is not included in v3.
4. Refresh SPEED manually only when you want to spend about 3 MiB.
5. Refresh DNS manually only when you intend to clear the DNS cache.
