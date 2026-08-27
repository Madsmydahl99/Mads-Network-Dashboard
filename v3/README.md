# Mads Network Dashboard v3

A four-panel Surge iOS dashboard designed for readable, low-overhead network diagnostics.

## What each panel means

- **NETWORK** shows the active access network, LAN/gateway, public IPv4, locally resolved country/ASN/organization, IPv6 availability, and the current `DIRECT-SELECT` decision. A network-change event clears the old WAN cache so stale identity is not carried onto another Wi-Fi network.
- **CONNECTIVITY** measures end-to-end HTTP response time to four deliberately different endpoints. It is not ICMP ping: the displayed time includes DNS resolution, connection setup, TLS, and the server response. The Cloudflare and Apple endpoints also act as captive-portal canaries.
- **DNS** reads the current Surge DNS cache, observed resolvers, lookup delay, and network-provided DNS. Automatic evaluations are read-only. Only a manual panel refresh flushes the cache.
- **SPEED · MANUAL** runs only from a manual refresh. It transfers about 3 MiB total (2 MiB download and 1 MiB upload) and stores the last result. Its RTT/variation values come from five small HTTP probes and are not ICMP ping.

## Safety boundary

The module contains only `[Panel]` and `[Script]` sections. It does not modify routing, proxies, DNS servers, IPv6 settings, rules, MITM, hosts, rewrites, or policy groups.

## Upgrade

1. Install and verify v3.
2. Disable both the earlier **Mads Network Dashboard** module and **Mads Network Dashboard v2** after v3 renders successfully.
3. This removes the obsolete **Sub Intelligence** panel because it belongs to the earlier module and is not included in v3.
4. Refresh SPEED manually only when you want to spend about 3 MiB.
5. Refresh DNS manually only when you intend to clear the DNS cache.
