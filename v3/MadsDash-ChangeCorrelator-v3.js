/* Mads Network Dashboard v3 — CHANGE CORRELATOR
 * Read-only timeline that connects network/engine events with observable
 * reachability changes. It never changes routing, DNS, modules or policies.
 */
(function () {
  'use strict';

  var STORE_KEY = 'MadsDash.ChangeCorrelator.v3';
  var MAX_EVENTS = 12;
  var MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  var PROBE_TIMEOUT = 6;
  var targets = [
    { key: 'CF', url: 'https://cp.cloudflare.com/generate_204', canary: 'cloudflare' },
    { key: 'Apple', url: 'https://captive.apple.com/hotspot-detect.html', canary: 'apple' },
    { key: 'OpenAI', url: 'https://api.openai.com/v1/models' }
  ];

  function now() { return Date.now(); }

  function clean(value, fallback) {
    var text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 48) : (fallback || '—');
  }

  function readState() {
    try {
      var raw = $persistentStore.read(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.version !== 1) return { version: 1, current: null, events: [] };
      parsed.events = Array.isArray(parsed.events) ? parsed.events.filter(function (item) {
        return item && item.at && now() - item.at <= MAX_AGE;
      }).slice(0, MAX_EVENTS) : [];
      return parsed;
    } catch (e) {
      return { version: 1, current: null, events: [] };
    }
  }

  function saveState(state) {
    state.version = 1;
    state.events = (state.events || []).slice(0, MAX_EVENTS);
    try { return $persistentStore.write(JSON.stringify(state), STORE_KEY); } catch (e) { return false; }
  }

  function networkSnapshot() {
    var net = (typeof $network !== 'undefined' && $network) ? $network : {};
    var wifi = net.wifi || {};
    var cell = net['cellular-data'] || {};
    var v4 = net.v4 || {};
    var v6 = net.v6 || {};
    var dns = Array.isArray(net.dns) ? net.dns : [];
    var access = 'Unknown';
    var identity = 'Unknown';

    if (wifi.ssid) {
      access = 'Wi-Fi';
      identity = clean(wifi.ssid, 'Wi-Fi');
    } else if (cell.radio || cell.carrier) {
      access = 'Cellular';
      identity = clean(cell.carrier || cell.radio, 'Cellular');
    } else if (!v4.primaryAddress && !v6.primaryAddress) {
      access = 'Offline';
      identity = 'No interface';
    }

    return {
      access: access,
      identity: identity,
      address: clean(v4.primaryAddress, '—'),
      gateway: clean(v4.primaryRouter, '—'),
      dns: dns.map(function (item) { return clean(item, ''); }).filter(Boolean).slice(0, 4).join(','),
      ipv6: !!v6.primaryAddress
    };
  }

  function probe(target, callback) {
    var started = now();
    $httpClient.get({
      url: target.url,
      timeout: PROBE_TIMEOUT,
      'auto-cookie': false,
      'auto-redirect': false,
      headers: { 'User-Agent': 'Surge-MadsDash/3.1', 'Cache-Control': 'no-cache' }
    }, function (error, response, data) {
      var status = response ? Number(response.status || response.statusCode || 0) : 0;
      var reachable = !error && status > 0;
      var portal = false;
      if (target.canary === 'cloudflare' && reachable) portal = status !== 204;
      if (target.canary === 'apple' && reachable) {
        portal = status !== 200 || String(data || '').toLowerCase().indexOf('success') < 0;
      }
      callback({ key: target.key, reachable: reachable, portal: portal, ms: now() - started, status: status });
    });
  }

  function healthSnapshot(callback) {
    var pending = targets.length;
    var byKey = {};
    targets.forEach(function (target) {
      probe(target, function (result) {
        byKey[result.key] = result;
        pending -= 1;
        if (pending) return;

        var results = targets.map(function (item) { return byKey[item.key]; });
        var online = results.filter(function (item) { return item.reachable; });
        var portal = results.some(function (item) { return item.portal; });
        var avg = online.length ? Math.round(online.reduce(function (sum, item) {
          return sum + item.ms;
        }, 0) / online.length) : null;
        var state = 'healthy';
        if (portal) state = 'portal';
        else if (!online.length) state = 'offline';
        else if (online.length < results.length || (avg !== null && avg > 450)) state = 'degraded';

        callback({ state: state, online: online.length, total: results.length, avg: avg, probes: results });
      });
    });
  }

  function changed(previous, current) {
    if (!previous) return { network: [], health: false, latency: false };
    var fields = [];
    if (previous.network.access !== current.network.access) fields.push('access');
    if (previous.network.identity !== current.network.identity) fields.push('network');
    if (previous.network.gateway !== current.network.gateway) fields.push('gateway');
    if (previous.network.dns !== current.network.dns) fields.push('DNS');
    if (previous.network.ipv6 !== current.network.ipv6) fields.push('IPv6');
    var prevAvg = previous.health.avg;
    var nextAvg = current.health.avg;
    var latency = prevAvg !== null && nextAvg !== null && nextAvg > Math.max(prevAvg * 2, prevAvg + 150);
    return {
      network: fields,
      health: previous.health.state !== current.health.state || previous.health.online !== current.health.online,
      latency: latency
    };
  }

  function firstFailed(health) {
    var failed = (health.probes || []).filter(function (item) { return !item.reachable; });
    return failed.length === 1 ? failed[0].key : '';
  }

  function correlate(previous, current, delta, cause) {
    if (!previous) return { title: 'Baseline created', verdict: 'Watching for meaningful changes' };
    if (current.health.state === 'portal') {
      return { title: 'Captive portal suspected', verdict: 'Wi-Fi login interception observed' };
    }
    if (previous.health.state !== 'healthy' && current.health.state === 'healthy') {
      return { title: 'Connectivity recovered', verdict: delta.network.length ? 'After path change' : 'Without a local path change' };
    }
    if (current.network.access === 'Offline' || current.health.state === 'offline') {
      return { title: 'Internet unavailable', verdict: delta.network.length ? 'Coincides with network change' : 'No local path change observed' };
    }
    if ((current.health.state === 'degraded' || delta.latency) && delta.network.length) {
      return { title: 'Path change + degradation', verdict: 'Local handoff is a likely contributor' };
    }
    if (current.health.state === 'degraded') {
      var one = firstFailed(current.health);
      return { title: one ? one + ' degraded' : 'Connectivity degraded', verdict: 'Remote service or route is more likely' };
    }
    if (delta.latency) {
      return { title: 'Web RTT jumped', verdict: delta.network.length ? 'Coincides with path change' : 'No local path change observed' };
    }
    if (delta.network.length) {
      return { title: 'Network changed cleanly', verdict: 'No degradation detected' };
    }
    return { title: cause === 'engine-started' ? 'Surge engine started' : 'No meaningful change', verdict: 'Current path remains healthy' };
  }

  function accessLabel(sample) {
    if (!sample) return 'No baseline';
    var net = sample.network;
    return net.access + (net.identity && net.identity !== net.access && net.identity !== 'No interface' ? ' · ' + net.identity : '');
  }

  function healthLabel(health) {
    if (!health) return 'Unknown';
    var labels = { healthy: 'Healthy', degraded: 'Degraded', offline: 'Offline', portal: 'Portal?' };
    var text = labels[health.state] || 'Unknown';
    text += ' · ' + health.online + '/' + health.total;
    if (health.avg !== null) text += ' · ' + health.avg + 'ms';
    return text;
  }

  function timeLabel(timestamp) {
    var d = new Date(timestamp);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function eventDetail(previous, current, delta) {
    var parts = [];
    if (previous && previous.network.access !== current.network.access) {
      parts.push(previous.network.access + ' → ' + current.network.access);
    } else if (delta.network.length) {
      parts.push(delta.network.slice(0, 3).join(' + ') + ' changed');
    }
    parts.push(current.health.online + '/' + current.health.total + ' reachable');
    return parts.join(' · ');
  }

  function shouldRecord(previous, delta, cause, correlation) {
    return !previous || cause === 'network-changed' || cause === 'engine-started' ||
      delta.network.length > 0 || delta.health || delta.latency || correlation.title !== 'No meaningful change';
  }

  function recordSample(state, sample, cause) {
    var previous = state.current;
    var delta = changed(previous, sample);
    var correlation = correlate(previous, sample, delta, cause);
    if (shouldRecord(previous, delta, cause, correlation)) {
      state.events.unshift({
        at: sample.at,
        cause: cause,
        title: correlation.title,
        verdict: correlation.verdict,
        detail: eventDetail(previous, sample, delta)
      });
    }
    state.current = sample;
    saveState(state);
    return correlation;
  }

  function recordNotification() {
    var data = (typeof $event !== 'undefined' && $event && $event.data) ? $event.data : {};
    var raw = clean(data.title || data.subtitle || data.body || data.message || '', '');
    if (!/(profile|configuration|config|reload|module|policy|dns|network|proxy|配置|模块|策略|网络)/i.test(raw)) return;
    var state = readState();
    state.events.unshift({
      at: now(), cause: 'notification', title: 'Configuration signal',
      verdict: 'Relevant Surge notification observed', detail: 'Message content not retained'
    });
    saveState(state);
  }

  function render(state, correlation) {
    var current = state.current;
    var health = current ? current.health : null;
    var lines = [healthLabel(health) + ' · ' + accessLabel(current)];
    var latest = state.events.slice(0, 3);
    if (!latest.length) lines.push('No changes recorded yet');
    latest.forEach(function (item) {
      lines.push(timeLabel(item.at) + '  ' + item.title);
      lines.push('↳ ' + item.detail + ' · ' + item.verdict);
    });
    lines.push('Refresh samples now · 7-day local history · read-only');

    var icon = 'point.3.connected.trianglepath.dotted';
    var color = '#4A789C';
    if (health && (health.state === 'degraded' || health.state === 'portal')) {
      icon = 'exclamationmark.triangle'; color = '#9A7647';
    } else if (health && health.state === 'offline') {
      icon = 'xmark.circle'; color = '#B85C5C';
    } else if (correlation && correlation.title === 'Connectivity recovered') {
      icon = 'arrow.triangle.2.circlepath'; color = '#497C64';
    }

    $done({ title: 'CHANGE CORRELATOR', content: lines.join('\n'), icon: icon, 'icon-color': color });
  }

  function sample(cause, finish) {
    var state = readState();
    var network = networkSnapshot();
    healthSnapshot(function (health) {
      var current = { at: now(), cause: cause, network: network, health: health };
      var correlation = recordSample(state, current, cause);
      finish(state, correlation);
    });
  }

  var eventName = (typeof $event !== 'undefined' && $event && $event.name) ? $event.name : '';
  if (eventName === 'notification') {
    recordNotification();
    $done();
    return;
  }
  if (eventName === 'network-changed') {
    setTimeout(function () { sample(eventName, function () { $done(); }); }, 1200);
    return;
  }
  if (eventName === 'engine-started') {
    setTimeout(function () { sample(eventName, function () { $done(); }); }, 500);
    return;
  }
  sample('panel-refresh', render);
})();
