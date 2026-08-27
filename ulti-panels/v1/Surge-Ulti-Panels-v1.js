/*
Surge Ulti Panels v1.0.1 — native Surge 5 iOS generic panels.
Read-only. No DNS flushes, policy changes, rule edits, profile reloads, request kills, or module toggles.
*/

const A = parseArgs(typeof $argument === "string" ? $argument : "");
const NAME = ($input && $input.panelName) ? String($input.panelName) : "Change Correlator";

const WORK = dec(A.WORK_POLICY || "Work");
const AI = dec(A.AI_POLICY || "AI");
const MEDIA = dec(A.MEDIA_POLICY || "Streaming");
const FAILOVER_A = dec(A.FAILOVER_A || WORK);
const FAILOVER_B = dec(A.FAILOVER_B || AI);
const PROBE_URL = dec(A.PROBE_URL || "https://cp.cloudflare.com/generate_204");

const STORE_PREFIX = "surge-ulti-panels-v1";
const API_TIMEOUT = clampInt(A.API_TIMEOUT, 4500, 1500, 10000);
const PROBE_TIMEOUT = clampInt(A.PROBE_TIMEOUT, 6500, 2000, 12000);

function dec(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, " ")); }
  catch (_) { return String(s); }
}
function parseArgs(s) {
  const out = {};
  String(s || "").split("&").forEach(function (p) {
    if (!p) return;
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i)] = p.slice(i + 1);
  });
  return out;
}
function clampInt(v, d, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
}
function api(method, path, body) {
  return new Promise(function (resolve) {
    if (typeof $httpAPI !== "function") return resolve(null);
    let done = false;
    const finish = function (x) {
      if (!done) { done = true; resolve(x == null ? null : x); }
    };
    setTimeout(function () { finish(null); }, API_TIMEOUT);
    try { $httpAPI(method, path, body || {}, finish); }
    catch (_) { finish(null); }
  });
}
function probe(url, policy) {
  return new Promise(function (resolve) {
    if (typeof $httpClient !== "object" || !$httpClient || typeof $httpClient.get !== "function") {
      return resolve({ok:null, ms:null, status:null});
    }
    const started = Date.now();
    let done = false;
    const finish = function (x) { if (!done) { done = true; resolve(x); } };
    setTimeout(function () { finish({ok:false, ms:null, status:null}); }, PROBE_TIMEOUT);
    try {
      const sep = String(url).indexOf("?") >= 0 ? "&" : "?";
      const req = {
        url: String(url) + sep + "_surge_ulti=" + Date.now(),
        timeout: Math.max(2, Math.floor(PROBE_TIMEOUT / 1000) - 1),
        "auto-cookie": false,
        "auto-redirect": false,
        headers: {"Cache-Control":"no-cache","Pragma":"no-cache"}
      };
      if (policy) req.policy = policy;
      $httpClient.get(req, function (err, res) {
        const status = res ? Number(res.status || res.statusCode || 0) : 0;
        finish({
          ok: !err && status > 0 && status < 500,
          ms: Date.now() - started,
          status: status || null
        });
      });
    } catch (_) { finish({ok:false, ms:null, status:null}); }
  });
}
function readStore(key) {
  try {
    if (!$persistentStore || typeof $persistentStore.read !== "function") return null;
    const s = $persistentStore.read(STORE_PREFIX + "-" + key);
    return s ? JSON.parse(s) : null;
  } catch (_) { return null; }
}
function writeStore(key, value) {
  try {
    if ($persistentStore && typeof $persistentStore.write === "function") {
      return $persistentStore.write(JSON.stringify(value), STORE_PREFIX + "-" + key);
    }
  } catch (_) {}
  return false;
}
function arr(x) {
  if (Array.isArray(x)) return x;
  if (!x || typeof x !== "object") return [];
  const keys = ["requests","recent","items","data","records","results"];
  for (let i=0;i<keys.length;i++) if (Array.isArray(x[keys[i]])) return x[keys[i]];
  return [];
}
function pick(o, keys) {
  if (!o || typeof o !== "object") return null;
  for (let i=0;i<keys.length;i++) {
    const v = o[keys[i]];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}
function hostOf(x) {
  const h = pick(x, ["hostname","host","domain","serverName","sni"]);
  if (h) return String(h).replace(/\?.*$/, "");
  const url = pick(x, ["url","URL"]);
  if (url) {
    const m = String(url).match(/^[a-z]+:\/\/([^\/?#]+)/i);
    if (m) return m[1].replace(/:\d+$/, "");
  }
  return "unknown";
}
function policyOf(x) {
  const v = pick(x, ["policy","policyName","outbound","outboundMode","policy_name"]);
  return v == null ? null : String(v);
}
function ruleOf(x) {
  const v = pick(x, ["rule","ruleName","matchedRule","ruleText","rule_name"]);
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") return String(pick(v, ["name","text","rule","payload","type"]) || "rule");
  return String(v);
}
function statusOf(x) {
  const n = Number(pick(x, ["status","statusCode","status_code","responseStatus"]));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function failedOf(x) {
  const st = statusOf(x);
  const err = pick(x, ["error","failed","failure","errorMessage"]);
  return !!err || (st != null && st >= 400);
}
function mark(v) { return v === true ? "✓" : v === false ? "×" : "?"; }
function ms(v) { return Number.isFinite(Number(v)) ? Math.round(Number(v)) + "ms" : "—"; }
function dnsDelayMs(raw) {
  if (!raw || typeof raw !== "object") return null;
  const explicitMs = Number(pick(raw,["ms","milliseconds"]));
  if (Number.isFinite(explicitMs)) return Math.round(explicitMs);
  const seconds = Number(pick(raw,["delay","latency"]));
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}
function pct(n,d) { return d > 0 ? Math.round((n/d)*100) + "%" : "—"; }
function short(s,n) {
  s = String(s == null ? "—" : s);
  return s.length > n ? s.slice(0,Math.max(1,n-1)) + "…" : s;
}
function pad(s,n) {
  s = String(s);
  while (s.length < n) s += " ";
  return s;
}
function countBy(rows, fn) {
  const m = {};
  rows.forEach(function (x) {
    const k = fn(x);
    if (!k) return;
    m[k] = (m[k] || 0) + 1;
  });
  return Object.keys(m).map(function(k){return [k,m[k]];}).sort(function(a,b){return b[1]-a[1];});
}
function networkSnapshot() {
  const n = (typeof $network === "object" && $network) ? $network : {};
  const wifi = n.wifi || {};
  const v4 = n.v4 || {};
  const v6 = n.v6 || {};
  return {
    ssid: wifi.ssid || null,
    bssid: wifi.bssid || null,
    v4: v4.primaryAddress || null,
    v6: v6.primaryAddress || null,
    dns: Array.isArray(n.dns) ? n.dns.slice(0,6) : [],
    ts: Date.now()
  };
}
function fingerprint(n) {
  return [
    n.ssid || "no-ssid",
    n.v4 ? String(n.v4).split(".").slice(0,3).join(".") : "no-v4",
    n.v6 ? "v6" : "no-v6",
    (n.dns || []).join(",")
  ].join("|");
}
function panel(title, content, style, icon, color) {
  $done({
    title:title,
    content:content,
    style:style || "info",
    icon:icon || "waveform.path.ecg",
    "icon-color":color || "#367AC4"
  });
}
function noData(title, what) {
  panel(title, what + "\n\nNo changes were made", "alert", "exclamationmark.triangle", "#B77700");
}

async function changeCorrelator() {
  const values = await Promise.all([
    api("GET","/v1/requests/recent",{}),
    api("GET","/v1/outbound",{}),
    api("POST","/v1/test/dns_delay",{})
  ]);
  const rows = arr(values[0]);
  const outbound = values[1];
  const dnsDelay = values[2];
  const net = networkSnapshot();
  const mode = outbound && pick(outbound,["mode","outboundMode","policy"]) || null;
  const delay = dnsDelayMs(dnsDelay);
  const errors = rows.filter(failedOf);

  const current = {
    ts:Date.now(),
    fp:fingerprint(net),
    mode:mode,
    dnsDelay:Number.isFinite(delay) ? delay : null,
    errors:errors.length,
    requests:rows.length
  };
  const prev = readStore("correlator");
  writeStore("correlator", current);

  const changes = [];
  if (prev) {
    if (prev.fp !== current.fp) changes.push("network fingerprint");
    if (prev.mode !== current.mode && (prev.mode || current.mode)) changes.push("outbound mode");
    if (Number.isFinite(prev.dnsDelay) && Number.isFinite(current.dnsDelay) &&
        Math.abs(prev.dnsDelay-current.dnsDelay) >= 40) changes.push("DNS delay");
  }

  let verdict = "Baseline captured";
  let detail = "Refresh later to compare state changes with request errors.";
  if (prev) {
    if (changes.length && current.errors > prev.errors) {
      verdict = "Possible correlation";
      detail = changes.join(" + ") + " changed; recent errors rose " + prev.errors + " → " + current.errors + ".";
    } else if (changes.length) {
      verdict = "Change observed";
      detail = changes.join(" + ") + " changed, but recent errors did not rise.";
    } else if (current.errors > prev.errors) {
      verdict = "Errors rose";
      detail = "Recent errors increased without a detected local state change.";
    } else {
      verdict = "Stable sample";
      detail = "No meaningful state/error change since previous refresh.";
    }
  }

  const firstErr = errors[0];
  const errLine = firstErr
    ? short(hostOf(firstErr),28) + " · " + (statusOf(firstErr) || "error") + " · " + (policyOf(firstErr) || "policy ?")
    : "No error evidence in recent requests";

  panel(
    "Change Correlator · " + verdict,
    detail +
    "\n\nErrors  " + current.errors + "/" + current.requests +
    "\nDNS     " + (current.dnsDelay == null ? "—" : current.dnsDelay + "ms") +
    "\nMode    " + (current.mode || "unavailable") +
    "\n\nLatest evidence\n" + errLine +
    "\n\nCorrelation is heuristic · read-only",
    changes.length && prev && current.errors > prev.errors ? "alert" : "info",
    "point.3.connected.trianglepath.dotted",
    "#7A5AF8"
  );
}

async function routeDrift() {
  const rows = arr(await api("GET","/v1/requests/recent",{}));
  if (!rows.length) return noData("Route Drift · unavailable","No recent request evidence");

  const map = {};
  rows.forEach(function(x){
    const h = hostOf(x), p = policyOf(x);
    if (h !== "unknown" && p) map[h] = p;
  });

  const prev = readStore("routes") || {};
  const drift = [];
  Object.keys(map).forEach(function(h){
    if (prev[h] && prev[h] !== map[h]) drift.push([h,prev[h],map[h]]);
  });
  writeStore("routes",map);

  if (!drift.length) {
    const top = countBy(rows,policyOf).slice(0,4);
    return panel(
      "Route Drift · stable",
      "No host policy changes detected vs previous refresh.\n\nCurrent policy mix\n" +
      (top.length ? top.map(x=>short(x[0],22)+"  "+x[1]).join("\n") : "Policy field unavailable") +
      "\n\nRefresh updates baseline",
      "info","arrow.triangle.branch","#367AC4"
    );
  }

  const lines = drift.slice(0,5).map(function(d){
    return short(d[0],27) + "\n  " + short(d[1],18) + " → " + short(d[2],18);
  });
  panel(
    "Route Drift · " + drift.length + " changed",
    lines.join("\n") + (drift.length>5 ? "\n+"+(drift.length-5)+" more" : "") +
    "\n\nObserved from recent requests · read-only",
    "alert","arrow.triangle.swap","#B77700"
  );
}

function dnsEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const ks = ["cache","records","entries","items","data"];
  for (let i=0;i<ks.length;i++) if (Array.isArray(raw[ks[i]])) return raw[ks[i]];
  return [];
}

async function dnsLens() {
  const values = await Promise.all([
    api("POST","/v1/test/dns_delay",{}),
    api("GET","/v1/dns",{})
  ]);
  const delayRaw = values[0], cacheRaw = values[1];
  const net = networkSnapshot();
  const delay = dnsDelayMs(delayRaw);
  const cache = dnsEntries(cacheRaw);
  const level = Number.isFinite(delay) ? (delay<50 ? "fast" : delay<120 ? "moderate" : "slow") : "unknown";

  panel(
    "DNS Lens · " + level,
    "DNS delay   " + ms(delay) +
    "\nResolvers   " + (net.dns.length || "—") +
    "\nCache rows  " + (cache.length || "—") +
    "\n\nCurrent resolvers\n" +
    (net.dns.length ? net.dns.slice(0,3).map(x=>short(x,29)).join("\n") : "Resolver list unavailable") +
    "\n\nNo cache flush performed",
    level === "slow" ? "alert" : "info",
    "magnifyingglass.circle","#4F7CAC"
  );
}

async function latencyRadar() {
  const targets = [
    ["Work","https://github.com/generate_204",WORK],
    ["AI","https://chatgpt.com/",AI],
    ["Media","https://open.spotify.com/",MEDIA]
  ];
  const all = await Promise.all([
    api("POST","/v1/test/dns_delay",{}),
    Promise.all(targets.map(x=>probe(x[1],x[2])))
  ]);
  const dnsRaw = all[0], probes = all[1];
  const d = dnsDelayMs(dnsRaw);
  const vals = probes.map(x=>x && Number.isFinite(x.ms) ? x.ms : null).filter(Number.isFinite);
  const slowest = vals.length ? Math.max.apply(null,vals) : null;

  const lines = targets.map(function(x,i){
    const q = probes[i] || {};
    return pad(x[0],6) + " " + mark(q.ok) + " " + ms(q.ms) + " · " + short(x[2],18);
  });

  panel(
    "Latency Radar · " + (slowest==null ? "limited" : slowest<250 ? "healthy" : "slow path"),
    "DNS    " + ms(d) + "\n" + lines.join("\n") +
    "\n\nPolicy-bound HTTP probes · not ICMP",
    slowest != null && slowest >= 500 ? "alert" : "info",
    "scope","#367AC4"
  );
}

async function ruleHeatmap() {
  const rows = arr(await api("GET","/v1/requests/recent",{}));
  if (!rows.length) return noData("Rule Heatmap · unavailable","No recent request evidence");

  let counts = countBy(rows,ruleOf);
  let label = "Rule matches";
  if (!counts.length) {
    counts = countBy(rows,policyOf);
    label = "Policy matches (rule field unavailable)";
  }
  if (!counts.length) return noData("Rule Heatmap · unavailable","Neither rule nor policy fields were exposed");

  const total = counts.reduce((a,x)=>a+x[1],0);
  const lines = counts.slice(0,5).map(function(x){
    return pad(short(x[0],23),24) + " " + String(x[1]).padStart(3) + " " + pct(x[1],total);
  });

  panel(
    "Rule Heatmap · top " + Math.min(5,counts.length),
    label + " · " + total + " recent\n\n" + lines.join("\n") +
    "\n\nRanking only · no rule changes",
    "info","flame","#C66A2B"
  );
}

async function connectionDNA() {
  const n = networkSnapshot();
  const fp = fingerprint(n);
  const prev = readStore("dna");
  const seen = readStore("dna-seen") || {};
  const known = !!seen[fp];

  seen[fp] = Date.now();
  const keys = Object.keys(seen);
  if (keys.length > 12) {
    keys.sort((a,b)=>seen[b]-seen[a]).slice(12).forEach(k=>delete seen[k]);
  }
  writeStore("dna",{fp:fp,ts:Date.now()});
  writeStore("dna-seen",seen);

  const changed = !!(prev && prev.fp !== fp);
  panel(
    "Connection DNA · " + (known ? "known" : "new"),
    "SSID   " + (n.ssid || "unavailable") +
    "\nIPv4   " + (n.v4 ? "✓ " + short(n.v4,23) : "—") +
    "\nIPv6   " + (n.v6 ? "✓" : "—") +
    "\nDNS    " + (n.dns.length ? n.dns.length+" resolver(s)" : "—") +
    "\n\nFingerprint " + (changed ? "changed since last refresh" : "stable since last refresh") +
    "\nSeen profiles  " + Object.keys(seen).length +
    "\n\nLocal metadata only",
    changed ? "alert" : "info",
    "circle.hexagongrid","#725AC1"
  );
}

async function failoverBrain() {
  const pair = [
    [FAILOVER_A,await probe(PROBE_URL,FAILOVER_A)],
    [FAILOVER_B,await probe(PROBE_URL,FAILOVER_B)]
  ];
  const healthy = pair.filter(x=>x[1] && x[1].ok);

  let verdict = "No healthy candidate";
  if (healthy.length === 2) {
    healthy.sort((a,b)=>a[1].ms-b[1].ms);
    verdict = healthy[0][0] + " leads by " + Math.round(healthy[1][1].ms-healthy[0][1].ms) + "ms";
  } else if (healthy.length === 1) {
    verdict = healthy[0][0] + " is the only healthy probe";
  }

  const lines = pair.map(function(x){
    return pad(short(x[0],19),20) + " " + mark(x[1].ok) + " " + ms(x[1].ms) +
      (x[1].status ? " · " + x[1].status : "");
  });

  panel(
    "Failover Brain · evidence",
    lines.join("\n") + "\n\n" + verdict +
    "\n\nProbe evidence, not Surge's hidden decision trace.\nNo policy selection performed.",
    healthy.length === 0 ? "alert" : "info",
    "brain.head.profile","#7A5AF8"
  );
}

async function quietNetwork() {
  const rows = arr(await api("GET","/v1/requests/recent",{}));
  if (!rows.length) return noData("Quiet Network · unavailable","No recent request evidence");

  const hosts = countBy(rows,hostOf).filter(x=>x[0] !== "unknown");
  const errors = rows.filter(failedOf).length;
  const lines = hosts.slice(0,5).map(function(x){
    return pad(short(x[0],27),28) + " " + String(x[1]).padStart(3);
  });

  panel(
    "Quiet Network · recent chatter",
    "Recent requests  " + rows.length +
    "\nUnique hosts     " + hosts.length +
    "\nErrors           " + errors +
    "\n\nTop talkers\n" + (lines.length ? lines.join("\n") : "Host field unavailable") +
    "\n\nRecent-window analysis; not guaranteed idle traffic",
    "info","moon.stars","#586A86"
  );
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
      return panel(
        "Surge Ulti Panels",
        "Unknown panel name: " + NAME +
        "\n\nExpected:\nChange Correlator\nRoute Drift\nDNS Lens\nLatency Radar\nRule Heatmap\nConnection DNA\nFailover Brain\nQuiet Network",
        "alert","questionmark.circle","#B77700"
      );
  }
}

main().catch(function(e){
  panel(
    "Surge Ulti Panels · unavailable",
    "Runtime error\n" + short(e && e.message ? e.message : e,120) +
    "\n\nNo changes were made",
    "alert","exclamationmark.triangle","#B77700"
  );
});
