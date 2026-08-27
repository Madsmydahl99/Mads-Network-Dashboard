/*
 * Surge Ulti Panels v2.0
 * Native Surge 5 iOS information panels.
 *
 * Design:
 * - native SF Symbols + per-state colors (no generic info/alert icon)
 * - compact signal → evidence → context formatting
 * - zero-config policy discovery where possible
 * - strict error classification: HTTP 4xx is not treated as a network failure
 * - read-only: no policy selection, DNS flush, rule edit, reload, kill, or module mutation
 */

const A = parseArgs(typeof $argument === "string" ? $argument : "");
const NAME = ($input && $input.panelName) ? String($input.panelName) : "Change Correlator";
const STORE = "surge-ulti-panels-v2";
const API_TIMEOUT = intArg("API_TIMEOUT", 4500, 1500, 10000);
const PROBE_TIMEOUT = intArg("PROBE_TIMEOUT", 6500, 2500, 12000);
const PROBE_URL = decodeArg(A.PROBE_URL || "https://cp.cloudflare.com/generate_204");
const PROBE_CACHE_MS = 20000;

const C = {
  green: "#34A853",
  blue: "#4285F4",
  cyan: "#0891B2",
  teal: "#0F9D8C",
  amber: "#D99000",
  red: "#D94A4A",
  purple: "#7C5CFC",
  slate: "#64748B"
};

function parseArgs(s) {
  const o = {};
  String(s || "").split("&").forEach(function (p) {
    if (!p) return;
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i)] = p.slice(i + 1);
  });
  return o;
}
function decodeArg(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, " ")); }
  catch (_) { return String(s); }
}
function intArg(k, d, lo, hi) {
  const n = Number(A[k]);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
}
function uniq(xs) {
  const out = [];
  xs.forEach(function (x) {
    x = String(x == null ? "" : x).trim();
    if (x && out.indexOf(x) < 0) out.push(x);
  });
  return out;
}
function trim(s, n) {
  s = String(s == null ? "—" : s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
}
function upper(s) { return String(s || "").toUpperCase(); }
function fmtMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return Math.round(n) + "ms";
}
function fmtPct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) + "%" : "—";
}
function ago(ts) {
  const d = Date.now() - Number(ts || 0);
  if (!Number.isFinite(d) || d < 0) return "now";
  if (d < 60000) return Math.max(1, Math.round(d / 1000)) + "s ago";
  if (d < 3600000) return Math.round(d / 60000) + "m ago";
  return Math.round(d / 3600000) + "h ago";
}
function api(method, path, body) {
  return new Promise(function (resolve) {
    if (typeof $httpAPI !== "function") return resolve(null);
    let finished = false;
    const done = function (v) {
      if (finished) return;
      finished = true;
      resolve(v == null ? null : v);
    };
    setTimeout(function () { done(null); }, API_TIMEOUT);
    try { $httpAPI(method, path, body == null ? {} : body, done); }
    catch (_) { done(null); }
  });
}
function readStore(k) {
  try {
    if (!$persistentStore || typeof $persistentStore.read !== "function") return null;
    const raw = $persistentStore.read(STORE + "." + k);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function writeStore(k, v) {
  try {
    if ($persistentStore && typeof $persistentStore.write === "function") {
      return $persistentStore.write(JSON.stringify(v), STORE + "." + k);
    }
  } catch (_) {}
  return false;
}
function panel(title, lines, icon, color) {
  $done({
    title: title,
    content: Array.isArray(lines) ? lines.join("\n") : String(lines || ""),
    icon: icon,
    "icon-color": color
  });
}
function pathValue(o, path) {
  let cur = o;
  for (let i = 0; i < path.length; i++) {
    if (!cur || typeof cur !== "object" || !(path[i] in cur)) return null;
    cur = cur[path[i]];
  }
  return (cur === undefined || cur === null || cur === "") ? null : cur;
}
function firstValue(o, paths) {
  for (let i = 0; i < paths.length; i++) {
    const p = Array.isArray(paths[i]) ? paths[i] : [paths[i]];
    const v = pathValue(o, p);
    if (v !== null) return v;
  }
  return null;
}
function listFrom(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = ["requests", "recent", "items", "data", "records", "results"];
  for (let i = 0; i < keys.length; i++) if (Array.isArray(raw[keys[i]])) return raw[keys[i]];
  return [];
}
function hostOf(x) {
  const h = firstValue(x, [
    "hostname", "host", "domain", "serverName", "sni",
    ["request", "hostname"], ["request", "host"], ["request", "domain"],
    ["connection", "hostname"], ["connection", "host"]
  ]);
  if (h) return String(h).replace(/\?.*$/, "").replace(/:\d+$/, "");
  const url = firstValue(x, ["url", "URL", ["request", "url"]]);
  if (url) {
    const m = String(url).match(/^[a-z]+:\/\/([^\/?#]+)/i);
    if (m) return m[1].replace(/:\d+$/, "");
  }
  return "unknown";
}
function policyOf(x) {
  const v = firstValue(x, [
    "policy", "policyName", "policy_name", "outbound", "outboundMode",
    ["routing", "policy"], ["route", "policy"], ["connection", "policy"],
    ["outbound", "policy"], ["result", "policy"]
  ]);
  if (v == null || typeof v === "object") return null;
  return String(v);
}
function ruleOf(x) {
  const v = firstValue(x, [
    "rule", "ruleName", "rule_name", "matchedRule", "ruleText",
    ["routing", "rule"], ["route", "rule"], ["result", "rule"]
  ]);
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const q = firstValue(v, ["name", "text", "rule", "payload", "type"]);
    return q == null ? null : String(q);
  }
  return String(v);
}
function statusOf(x) {
  const v = firstValue(x, [
    "status", "statusCode", "status_code", "responseStatus",
    ["response", "status"], ["response", "statusCode"], ["result", "status"]
  ]);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function errorTextOf(x) {
  const v = firstValue(x, [
    "error", "errorMessage", "failure", "failedReason",
    ["response", "error"], ["result", "error"], ["connection", "error"]
  ]);
  if (v == null || v === false || v === 0 || v === "0") return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || /^(false|none|null|ok)$/i.test(s)) return null;
    return s;
  }
  if (typeof v === "object" && Object.keys(v).length === 0) return null;
  return trim(v, 80);
}
function classOf(x) {
  const err = errorTextOf(x);
  const s = statusOf(x);
  if (err) return "transport";
  if (s >= 500) return "server";
  if (s === 429) return "rate";
  if (s >= 400) return "client";
  return "ok";
}
function countBy(rows, fn) {
  const m = {};
  rows.forEach(function (x) {
    const k = fn(x);
    if (!k) return;
    m[k] = (m[k] || 0) + 1;
  });
  return Object.keys(m).map(function (k) { return [k, m[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; });
}
function isLocalNoiseHost(h) {
  h = String(h || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "unknown" || h === "localhost" || h === "::1" || h === "127.0.0.1") return true;
  if (/^127\./.test(h) || /^0\.0\.0\.0$/.test(h)) return true;
  if (h.endsWith(".local")) return true;
  return false;
}
function currentNetwork() {
  const n = (typeof $network === "object" && $network) ? $network : {};
  const wifi = n.wifi || {};
  const cell = n["cellular-data"] || {};
  const v4 = n.v4 || {};
  const v6 = n.v6 || {};
  let access = "Offline";
  let label = "No interface";
  if (wifi.ssid) {
    access = "Wi-Fi";
    label = String(wifi.ssid);
  } else if (cell.carrier || cell.radio) {
    access = "Cellular";
    label = String(cell.carrier || cell.radio);
  } else if (v4.primaryAddress || v6.primaryAddress) {
    access = "Network";
    label = "Connected";
  }
  return {
    access: access,
    label: label,
    ssid: wifi.ssid || null,
    v4: v4.primaryAddress || null,
    gateway: v4.primaryRouter || null,
    v6: v6.primaryAddress || null,
    dns: Array.isArray(n.dns) ? n.dns.filter(Boolean).slice(0, 6) : [],
    at: Date.now()
  };
}
function netFingerprint(n) {
  return [
    n.access, n.label,
    n.gateway || "no-gw",
    n.v4 ? String(n.v4).split(".").slice(0, 3).join(".") : "no-v4",
    n.v6 ? "v6" : "no-v6",
    (n.dns || []).join(",")
  ].join("|");
}
function networkDiff(a, b) {
  if (!a || !b) return [];
  const d = [];
  if (a.access !== b.access || a.label !== b.label) d.push("network");
  if (a.gateway !== b.gateway) d.push("gateway");
  if ((a.dns || []).join(",") !== (b.dns || []).join(",")) d.push("DNS");
  if (!!a.v6 !== !!b.v6) d.push("IPv6");
  return d;
}
function dnsDelayMs(raw) {
  if (!raw || typeof raw !== "object") return null;
  const explicit = Number(firstValue(raw, ["ms", "milliseconds"]));
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const sec = Number(firstValue(raw, ["delay", "latency"]));
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.round(sec * 1000);
}
function dnsEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = ["dnsCache", "cache", "records", "entries", "items", "data"];
  for (let i = 0; i < keys.length; i++) if (Array.isArray(raw[keys[i]])) return raw[keys[i]];
  return [];
}
function friendlyResolver(v) {
  const s = String(v || "").trim();
  const low = s.toLowerCase();
  if (!s) return "";
  if (low.indexOf("1.1.1.1") >= 0 || low.indexOf("cloudflare") >= 0) return "Cloudflare";
  if (low.indexOf("8.8.8.8") >= 0 || low.indexOf("8.8.4.4") >= 0 || low.indexOf("dns.google") >= 0) return "Google";
  if (low.indexOf("9.9.9.9") >= 0 || low.indexOf("quad9") >= 0) return "Quad9";
  if (low === "system") return "System";
  const m = s.match(/^https?:\/\/([^/]+)/i);
  return trim(m ? m[1] : s, 26);
}
function cacheResolvers(cache) {
  return uniq(cache.map(function (e) {
    return friendlyResolver(firstValue(e || {}, ["server", "resolver", "dnsServer"]));
  }).filter(Boolean));
}
function extractPolicyNames(raw) {
  const out = [];
  const skip = {time:1, results:1, result:1, winner:1, error:1, version:1, groups:1, policyGroups:1};
  function add(x) {
    x = String(x == null ? "" : x).trim();
    if (x && out.indexOf(x) < 0) out.push(x);
  }
  function walk(v, depth) {
    if (depth > 3 || v == null) return;
    if (typeof v === "string") { add(v); return; }
    if (Array.isArray(v)) {
      v.forEach(function (x) {
        if (typeof x === "string") add(x);
        else if (x && typeof x === "object") {
          const name = firstValue(x, ["name", "policy", "policyName", "groupName"]);
          if (name && typeof name !== "object") add(name);
          walk(x, depth + 1);
        }
      });
      return;
    }
    if (typeof v !== "object") return;
    ["policies", "available", "items", "data", "policyGroups", "groups"].forEach(function (k) {
      if (v[k] != null) walk(v[k], depth + 1);
    });
    Object.keys(v).forEach(function (k) {
      if (skip[k]) return;
      const val = v[k];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        if (!/^(data|meta|config|options)$/i.test(k)) add(k);
      }
    });
  }
  walk(raw, 0);
  return out;
}
function isProbeablePolicy(n) {
  return n && !/^(REJECT|REJECT-DROP|REJECT-TINYGIF|REJECT-NO-DROP)$/i.test(n);
}
function configuredPolicies() {
  const raw = decodeArg(A.PROBE_POLICIES || "");
  return uniq(raw.split(",").map(function (x) { return x.trim(); }).filter(Boolean));
}
function choosePolicies(rows, policyRaw, groupRaw) {
  const available = uniq(extractPolicyNames(policyRaw).concat(extractPolicyNames(groupRaw))).filter(isProbeablePolicy);
  const recent = countBy(rows, policyOf).map(function (x) { return x[0]; }).filter(isProbeablePolicy);
  const requested = configuredPolicies();
  const out = [];
  function push(x) {
    if (!x || !isProbeablePolicy(x) || out.indexOf(x) >= 0) return;
    if (available.length && available.indexOf(x) < 0 && recent.indexOf(x) < 0 && x !== "DIRECT") return;
    out.push(x);
  }
  requested.forEach(push);
  recent.forEach(push);
  if (available.indexOf("DIRECT") >= 0 || recent.indexOf("DIRECT") >= 0) push("DIRECT");
  available.forEach(push);
  if (!out.length) out.push("DIRECT");
  return out.slice(0, 3);
}
function findPolicyData(raw, name) {
  if (!raw || typeof raw !== "object") return null;
  const direct = [
    raw[name],
    raw.data && raw.data[name],
    raw.result && raw.result[name]
  ];
  for (let i = 0; i < direct.length; i++) if (direct[i] && typeof direct[i] === "object") return direct[i];
  if (Array.isArray(raw.results)) {
    for (let i = raw.results.length - 1; i >= 0; i--) {
      const r = raw.results[i] || {};
      if (r.data && r.data[name] && typeof r.data[name] === "object") return r.data[name];
      if (r[name] && typeof r[name] === "object") return r[name];
    }
  }
  return null;
}
function metricMs(o) {
  if (!o || typeof o !== "object") return null;
  const keys = ["rtt", "latency", "delay", "tcp", "available"];
  for (let i = 0; i < keys.length; i++) {
    const n = Number(o[keys[i]]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}
function probe(url, policy) {
  return new Promise(function (resolve) {
    if (!$httpClient || typeof $httpClient.get !== "function") {
      return resolve({policy:policy, ok:null, ms:null, status:null, source:"http"});
    }
    const started = Date.now();
    let finished = false;
    const done = function (r) {
      if (finished) return;
      finished = true;
      resolve(r);
    };
    setTimeout(function () {
      done({policy:policy, ok:false, ms:null, status:null, source:"http"});
    }, PROBE_TIMEOUT);
    try {
      const req = {
        url: url + (url.indexOf("?") >= 0 ? "&" : "?") + "_surge_ulti=" + Date.now(),
        timeout: Math.max(2, Math.floor(PROBE_TIMEOUT / 1000) - 1),
        "auto-cookie": false,
        "auto-redirect": false,
        headers: {"Cache-Control":"no-cache", "Pragma":"no-cache"}
      };
      if (policy) req.policy = policy;
      $httpClient.get(req, function (err, res) {
        const status = res ? Number(res.status || res.statusCode || 0) : 0;
        done({
          policy: policy,
          ok: !err && status > 0 && status < 500,
          ms: Date.now() - started,
          status: status || null,
          source: "http"
        });
      });
    } catch (_) {
      done({policy:policy, ok:false, ms:null, status:null, source:"http"});
    }
  });
}
async function policyHealth(rows) {
  const cached = readStore("policy-health");
  if (cached && cached.at && Date.now() - cached.at < PROBE_CACHE_MS && Array.isArray(cached.results)) {
    return cached;
  }
  const discovery = await Promise.all([
    api("GET", "/v1/policies", {}),
    api("GET", "/v1/policy_groups", {})
  ]);
  const names = choosePolicies(rows, discovery[0], discovery[1]);
  let results = [];
  let native = null;
  if (names.length) {
    native = await api("POST", "/v1/policies/test", {policy_names:names, url:PROBE_URL});
    results = names.map(function (name) {
      const d = findPolicyData(native, name);
      const m = metricMs(d);
      return {policy:name, ok:m != null, ms:m, status:null, source:"native"};
    });
  }
  if (!results.some(function (x) { return x.ok; })) {
    results = await Promise.all(names.map(function (n) { return probe(PROBE_URL, n); }));
  }
  const pack = {at:Date.now(), results:results, source:results[0] ? results[0].source : "none"};
  writeStore("policy-health", pack);
  return pack;
}
function dominantPolicy(rows) {
  const c = countBy(rows, policyOf);
  return c.length ? {name:c[0][0], count:c[0][1]} : null;
}
function requestStats(rows) {
  const out = {total:rows.length, hard:0, client:0, rate:0, ok:0, hardRows:[]};
  rows.forEach(function (x) {
    const c = classOf(x);
    if (c === "transport" || c === "server") { out.hard++; out.hardRows.push(x); }
    else if (c === "client") out.client++;
    else if (c === "rate") out.rate++;
    else out.ok++;
  });
  return out;
}
function shortIssue(x) {
  const h = trim(hostOf(x), 24);
  const s = statusOf(x);
  const e = errorTextOf(x);
  const p = policyOf(x);
  return h + " · " + (s || (e ? trim(e, 18) : "issue")) + (p ? " · " + trim(p, 16) : "");
}
function miniBar(p) {
  const n = Math.max(1, Math.min(5, Math.round(p * 5)));
  return "▮".repeat(n);
}

/* Panels */

async function changeCorrelator() {
  const values = await Promise.all([
    api("GET", "/v1/requests/recent", {}),
    api("GET", "/v1/outbound", {}),
    api("POST", "/v1/test/dns_delay", {})
  ]);
  const rows = listFrom(values[0]);
  const mode = values[1] && firstValue(values[1], ["mode", "outboundMode", "policy"]);
  const dns = dnsDelayMs(values[2]);
  const net = currentNetwork();
  const stats = requestStats(rows);
  const dom = dominantPolicy(rows);
  const current = {
    at: Date.now(),
    network: net,
    mode: mode || null,
    dns: dns,
    hard: stats.hard,
    client: stats.client,
    rate: stats.rate,
    dominant: dom ? dom.name : null
  };
  const prev = readStore("correlator");
  writeStore("correlator", current);

  const changes = prev ? networkDiff(prev.network, current.network) : [];
  if (prev && prev.mode !== current.mode && (prev.mode || current.mode)) changes.push("mode");
  if (prev && prev.dominant !== current.dominant && (prev.dominant || current.dominant)) changes.push("route");
  if (prev && Number.isFinite(prev.dns) && Number.isFinite(current.dns) && Math.abs(prev.dns - current.dns) >= 40) changes.push("DNS latency");

  const rose = !!(prev && stats.hard > Number(prev.hard || 0));
  let state = "BASELINE", color = C.blue, icon = "point.3.connected.trianglepath.dotted";
  let evidence = "First sample saved · refresh again to compare";
  if (prev) {
    if (changes.length && rose) {
      state = "LIKELY LINK"; color = C.red; icon = "exclamationmark.triangle.fill";
      evidence = changes.slice(0, 3).join(" + ") + " changed while hard issues rose";
    } else if (changes.length) {
      state = "PATH CHANGED"; color = C.purple; icon = "arrow.triangle.2.circlepath";
      evidence = changes.slice(0, 3).join(" + ") + " changed · no hard-issue spike";
    } else if (rose) {
      state = "WATCH"; color = C.amber; icon = "waveform.path.ecg";
      evidence = "Hard issues rose without a local path change";
    } else {
      state = "STABLE"; color = stats.hard ? C.amber : C.green; icon = stats.hard ? "waveform.path.ecg" : "checkmark.circle.fill";
      evidence = "No meaningful local-state change since previous sample";
    }
  }
  const summary = rows.length + " req · " + stats.hard + " hard · " + stats.client + " HTTP4xx" + (stats.rate ? " · " + stats.rate + " rate-limit" : "");
  const route = "Mode " + upper(mode || "—") + " · " + (dom ? trim(dom.name, 18) + " dominant" : "route unavailable") + " · DNS " + fmtMs(dns);
  const lines = [summary, evidence];
  if (stats.hardRows.length) lines.push("↳ " + shortIssue(stats.hardRows[0]));
  else if (stats.client) lines.push("↳ 4xx kept separate from network failures");
  lines.push(route);

  panel("CHANGE CORRELATOR · " + state, lines, icon, color);
}

async function routeDrift() {
  const rows = listFrom(await api("GET", "/v1/requests/recent", {}));
  const routed = rows.filter(function (x) { return !!policyOf(x); });
  const external = routed.filter(function (x) { return !isLocalNoiseHost(hostOf(x)); });
  const map = {};
  external.forEach(function (x) {
    const h = hostOf(x), p = policyOf(x);
    if (h !== "unknown" && p) map[h] = p;
  });
  const prev = readStore("route-map") || {};
  const drift = [];
  Object.keys(map).forEach(function (h) {
    if (prev[h] && prev[h] !== map[h]) drift.push([h, prev[h], map[h]]);
  });
  writeStore("route-map", map);

  const mix = countBy(routed, policyOf);
  const top = mix[0];
  const coverage = fmtPct(routed.length, rows.length);
  if (!drift.length) {
    const lines = [
      routed.length + "/" + rows.length + " routed · " + coverage + " coverage" + (top ? " · " + trim(top[0], 18) + " leads" : ""),
      "No observed host switched policy since previous sample",
      Object.keys(map).length + " external hosts in current route map"
    ];
    panel("ROUTE DRIFT · STABLE", lines, "arrow.triangle.branch", C.green);
    return;
  }
  const lines = [
    drift.length + " host route change" + (drift.length === 1 ? "" : "s") + " · " + coverage + " coverage"
  ];
  drift.slice(0, 3).forEach(function (d) {
    lines.push(trim(d[0], 21) + "  " + trim(d[1], 13) + " → " + trim(d[2], 13));
  });
  if (top) lines.push("↳ Current dominant route · " + trim(top[0], 18) + " " + fmtPct(top[1], routed.length));
  panel("ROUTE DRIFT · " + drift.length + " CHANGE" + (drift.length === 1 ? "" : "S"), lines, "arrow.triangle.swap", C.amber);
}

async function dnsLens() {
  const values = await Promise.all([
    api("GET", "/v1/dns", {}),
    api("POST", "/v1/test/dns_delay", {})
  ]);
  const cache = dnsEntries(values[0]);
  const delay = dnsDelayMs(values[1]);
  const net = currentNetwork();
  const used = cacheResolvers(cache);
  let state = "READY", color = C.teal, icon = "network";
  if (delay != null && delay > 250) { state = "SLOW"; color = C.red; icon = "tortoise.fill"; }
  else if (delay != null && delay > 100) { state = "DELAYED"; color = C.amber; icon = "gauge.with.dots.needle.67percent"; }
  else if (delay != null) { state = "FAST"; color = C.green; icon = "hare.fill"; }

  const lines = [
    (net.dns.length || 0) + " network DNS · " + cache.length + " cached answer" + (cache.length === 1 ? "" : "s")
  ];
  if (used.length) lines.push("Used · " + used.slice(0, 3).join(" · "));
  else if (net.dns.length) lines.push("Resolvers · " + net.dns.slice(0, 2).map(function (x) { return trim(x, 20); }).join(" · "));
  else lines.push("Resolvers · unavailable");
  lines.push("Lookup latency · " + (delay == null ? "not reported" : fmtMs(delay)));
  if (delay == null) lines.push("↳ Zero/empty API result is not labeled “fast”");
  panel("DNS LENS · " + state, lines, icon, color);
}

async function latencyRadar() {
  const rows = listFrom(await api("GET", "/v1/requests/recent", {}));
  const pack = await policyHealth(rows);
  const rs = Array.isArray(pack.results) ? pack.results : [];
  const healthy = rs.filter(function (x) { return x.ok && Number.isFinite(x.ms); }).sort(function (a, b) { return a.ms - b.ms; });
  const best = healthy[0] || null;
  const lines = [];
  rs.slice(0, 3).forEach(function (r) {
    if (r.ok && Number.isFinite(r.ms)) {
      const delta = best && r.policy !== best.policy ? "  +" + Math.max(0, Math.round(r.ms - best.ms)) : "";
      lines.push("✓ " + trim(r.policy, 19) + " · " + fmtMs(r.ms) + delta);
    } else {
      lines.push("× " + trim(r.policy, 19) + " · unavailable");
    }
  });
  if (!rs.length) lines.push("No probeable policy discovered");
  lines.push(best ? "Best · " + trim(best.policy, 20) + " · " + healthy.length + "/" + rs.length + " healthy" : "No healthy policy path");
  lines.push("↳ Auto-discovers current/available Surge policies");

  const state = !best ? "NO PATH" : healthy.length < rs.length ? "DEGRADED" : "HEALTHY";
  const color = !best ? C.red : healthy.length < rs.length ? C.amber : C.green;
  const icon = !best ? "xmark.circle.fill" : "scope";
  panel("LATENCY RADAR · " + state, lines, icon, color);
}

async function ruleHeatmap() {
  const rows = listFrom(await api("GET", "/v1/requests/recent", {}));
  let source = "rule";
  let counts = countBy(rows, ruleOf);
  let coverage = rows.filter(function (x) { return !!ruleOf(x); }).length;
  if (!counts.length) {
    source = "policy";
    counts = countBy(rows, policyOf);
    coverage = rows.filter(function (x) { return !!policyOf(x); }).length;
  }
  if (!counts.length) {
    panel("RULE HEATMAP · NO DATA", ["Recent requests expose no rule/policy metadata", rows.length + " requests inspected"], "flame", C.slate);
    return;
  }
  const total = counts.reduce(function (s, x) { return s + x[1]; }, 0);
  const top = counts[0];
  const lines = [];
  counts.slice(0, 4).forEach(function (x) {
    const p = total ? x[1] / total : 0;
    lines.push(trim(x[0], 18) + " · " + x[1] + " · " + miniBar(p) + " " + Math.round(p * 100) + "%");
  });
  lines.push((source === "rule" ? "Rule" : "Policy fallback") + " metadata · " + coverage + "/" + rows.length + " requests");
  const state = counts.length === 1 ? trim(top[0], 16) + " " + fmtPct(top[1], total) : "TOP " + Math.min(4, counts.length);
  panel("RULE HEATMAP · " + upper(state), lines, "flame.fill", C.amber);
}

async function connectionDNA() {
  const n = currentNetwork();
  const fp = netFingerprint(n);
  const seen = readStore("dna-seen") || {};
  const old = seen[fp] || null;
  const current = {
    count: old ? Number(old.count || 0) + 1 : 1,
    first: old && old.first ? old.first : Date.now(),
    last: Date.now()
  };
  seen[fp] = current;
  const keys = Object.keys(seen);
  if (keys.length > 16) {
    keys.sort(function (a, b) { return Number(seen[b].last || 0) - Number(seen[a].last || 0); })
      .slice(16).forEach(function (k) { delete seen[k]; });
  }
  writeStore("dna-seen", seen);
  const prev = readStore("dna-current");
  writeStore("dna-current", {fp:fp, network:n, at:Date.now()});
  const changed = !!(prev && prev.fp !== fp);

  const lines = [
    n.access + " · " + trim(n.label, 25),
    "IPv4 " + (n.v4 ? trim(n.v4, 18) : "—") + " · IPv6 " + (n.v6 ? "on" : "off"),
    "DNS " + n.dns.length + (n.gateway ? " · gateway " + trim(n.gateway, 18) : ""),
    "Seen " + current.count + "× · " + (changed ? "fingerprint changed" : "fingerprint stable")
  ];
  const state = old ? (changed ? "SWITCHED" : "KNOWN") : "NEW";
  panel("CONNECTION DNA · " + state, lines, "circle.hexagongrid.fill", changed ? C.purple : C.blue);
}

async function failoverBrain() {
  const rows = listFrom(await api("GET", "/v1/requests/recent", {}));
  const pack = await policyHealth(rows);
  const rs = Array.isArray(pack.results) ? pack.results : [];
  const healthy = rs.filter(function (x) { return x.ok && Number.isFinite(x.ms); }).sort(function (a, b) { return a.ms - b.ms; });
  const winner = healthy[0] || null;
  const runner = healthy[1] || null;
  const prev = readStore("failover-winner");
  writeStore("failover-winner", {policy:winner ? winner.policy : null, at:Date.now()});
  const changed = !!(winner && prev && prev.policy && prev.policy !== winner.policy);

  let state, color, icon;
  const lines = [];
  if (!winner) {
    state = "NO HEALTHY PATH"; color = C.red; icon = "xmark.octagon.fill";
    rs.slice(0, 3).forEach(function (r) { lines.push("× " + trim(r.policy, 22) + " · unavailable"); });
    if (!rs.length) lines.push("No probeable policy discovered");
  } else if (!runner) {
    state = "SINGLE PATH"; color = C.amber; icon = "exclamationmark.triangle.fill";
    lines.push("Winner · " + trim(winner.policy, 21) + " · " + fmtMs(winner.ms));
    lines.push("No second healthy candidate to compare");
  } else {
    state = changed ? "WINNER CHANGED" : "STABLE";
    color = changed ? C.purple : C.green;
    icon = changed ? "arrow.triangle.2.circlepath" : "checkmark.shield.fill";
    const margin = Math.max(0, Math.round(runner.ms - winner.ms));
    lines.push("Winner · " + trim(winner.policy, 21) + " · " + fmtMs(winner.ms));
    lines.push("Runner-up · " + trim(runner.policy, 18) + " · +" + margin + "ms");
    lines.push((rs.length - healthy.length) + " unhealthy · " + healthy.length + "/" + rs.length + " healthy");
    if (changed) lines.push("↳ " + trim(prev.policy, 16) + " → " + trim(winner.policy, 16) + " since last sample");
    else lines.push("↳ Health winner unchanged since last sample");
  }
  panel("FAILOVER BRAIN · " + state, lines, icon, color);
}

async function quietNetwork() {
  const rows = listFrom(await api("GET", "/v1/requests/recent", {}));
  const hidden = rows.filter(function (x) { return isLocalNoiseHost(hostOf(x)); }).length;
  const external = rows.filter(function (x) { return !isLocalNoiseHost(hostOf(x)); });
  const hosts = countBy(external, hostOf);
  const stats = requestStats(external);
  const currentMap = {};
  hosts.forEach(function (x) { currentMap[x[0]] = x[1]; });
  const prev = readStore("quiet-hosts") || {};
  writeStore("quiet-hosts", currentMap);

  let riser = null;
  Object.keys(currentMap).forEach(function (h) {
    const delta = currentMap[h] - Number(prev[h] || 0);
    if (delta > 0 && (!riser || delta > riser.delta)) riser = {host:h, delta:delta};
  });

  const lines = [
    external.length + " external req · " + hosts.length + " hosts · " + hidden + " local hidden"
  ];
  hosts.slice(0, 3).forEach(function (x) {
    lines.push(trim(x[0], 25) + " · " + x[1]);
  });
  lines.push(stats.hard + " hard · " + stats.client + " HTTP4xx" + (stats.rate ? " · " + stats.rate + " rate-limit" : ""));
  if (riser) lines.push("↳ Fastest riser · " + trim(riser.host, 20) + " +" + riser.delta);

  const state = stats.hard ? "ISSUES" : "CLEAN";
  panel("QUIET NETWORK · " + state, lines, "moon.stars.fill", stats.hard ? C.amber : C.slate);
}

async function main() {
  switch (NAME.toLowerCase()) {
    case "change correlator": return changeCorrelator();
    case "route drift": return routeDrift();
    case "dns lens": return dnsLens();
    case "latency radar": return latencyRadar();
    case "rule heatmap": return ruleHeatmap();
    case "connection dna": return connectionDNA();
    case "failover brain": return failoverBrain();
    case "quiet network": return quietNetwork();
    default:
      return panel("SURGE ULTI PANELS · UNKNOWN", ["Unknown panel · " + trim(NAME, 30)], "questionmark.circle.fill", C.red);
  }
}

main().catch(function (e) {
  panel("SURGE ULTI PANELS · ERROR", [trim(e && e.message ? e.message : e, 100), "No configuration changes were made"], "exclamationmark.triangle.fill", C.red);
});
