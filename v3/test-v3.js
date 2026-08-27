const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = __dirname;

function runScript(name, context, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not call $done`)), timeout);
    context.$done = value => {
      clearTimeout(timer);
      resolve(value);
    };
    context.console = console;
    context.Promise = Promise;
    context.Uint8Array = Uint8Array;
    context.Date = Date;
    context.String = String;
    context.Number = Number;
    context.Math = Math;
    context.JSON = JSON;
    context.Array = Array;
    context.isFinite = isFinite;
    vm.runInNewContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  });
}

async function main() {
  const networkStore = {};
  const network = await runScript('MadsDash-Network-v3.js', {
    $network: {
      wifi: { ssid: 'KK-Public' },
      v4: { primaryAddress: '10.0.0.2', primaryRouter: '10.0.0.1' },
      v6: {}
    },
    $persistentStore: {
      read: key => networkStore[key] || null,
      write: (value, key) => { networkStore[key] = value; return true; }
    },
    $surge: { selectGroupDetails: () => ({ decisions: { 'DIRECT-SELECT': 'DIRECT' } }) },
    $utils: { geoip: () => 'DK', ipasn: () => '209125', ipaso: () => 'København Kommune' },
    $httpClient: {
      get: (_options, callback) => callback(null, { status: 200 }, '193.1.2.3')
    }
  });
  assert(network.content.includes('Public 193.1.2.3'));
  assert(network.content.includes('Route DIRECT'));

  let eventRequestedNetwork = false;
  await runScript('MadsDash-Network-v3.js', {
    $event: { name: 'network-changed' },
    $persistentStore: { write: () => true },
    $httpClient: { get: () => { eventRequestedNetwork = true; } }
  });
  assert.strictEqual(eventRequestedNetwork, false);

  const endpointMap = {
    'https://cp.cloudflare.com/generate_204': [{ status: 204 }, ''],
    'https://captive.apple.com/hotspot-detect.html': [{ status: 200 }, '<TITLE>Success</TITLE>'],
    'https://api.github.com/': [{ status: 200 }, '{}'],
    'https://api.openai.com/v1/models': [{ status: 401 }, '{}']
  };
  const connectivity = await runScript('MadsDash-Connectivity-v3.js', {
    $httpClient: {
      get: (options, callback) => {
        const [response, body] = endpointMap[options.url];
        setImmediate(() => callback(null, response, body));
      }
    },
    setImmediate
  });
  assert(connectivity.content.includes('Web RTT'));
  assert(connectivity.content.includes('4/4 reachable'));
  assert(!connectivity.content.includes('portal?'));

  let autoFlushes = 0;
  const dnsAuto = await runScript('MadsDash-DNS-v3.js', {
    $trigger: 'auto-interval',
    $network: { dns: ['10.0.0.1'] },
    $persistentStore: { read: () => null, write: () => true },
    $httpAPI: (method, apiPath, _body, callback) => {
      if (apiPath === '/v1/dns/flush') autoFlushes += 1;
      if (apiPath === '/v1/dns') callback({ dnsCache: [{ server: '1.1.1.1' }] });
      else if (apiPath === '/v1/test/dns_delay') callback({ delay: 0.01 });
      else callback({});
    }
  });
  assert.strictEqual(autoFlushes, 0);
  assert(dnsAuto.content.includes('refresh clears'));

  let manualFlushes = 0;
  const dnsManual = await runScript('MadsDash-DNS-v3.js', {
    $trigger: 'button',
    $network: { dns: ['10.0.0.1'] },
    $persistentStore: { read: () => null, write: () => true },
    $httpAPI: (method, apiPath, _body, callback) => {
      if (apiPath === '/v1/dns/flush') { manualFlushes += 1; callback({}); return; }
      if (apiPath === '/v1/dns') callback({ dnsCache: [{ server: 'dns.google' }] });
      else if (apiPath === '/v1/test/dns_delay') callback({ delay: 0.02 });
      else callback({});
    }
  });
  assert.strictEqual(manualFlushes, 1);
  assert(dnsManual.content.includes('Cleared 1 cached DNS entry'));

  let speedRequests = 0;
  const speedIdle = await runScript('MadsDash-Speed-v3.js', {
    $trigger: 'auto-interval',
    $persistentStore: {
      read: () => JSON.stringify({ down: 76, up: 44, latency: 11, jitter: 4, at: Date.now() }),
      write: () => true
    },
    $httpClient: {
      get: () => { speedRequests += 1; },
      post: () => { speedRequests += 1; }
    }
  });
  assert.strictEqual(speedRequests, 0);
  assert(speedIdle.title.includes('MANUAL'));

  const trafficStore = {};
  const trafficMap = {
    en0: {
      inCurrentSpeed: 1250000,
      outCurrentSpeed: 125000,
      inMaxSpeed: 12500000,
      outMaxSpeed: 2500000,
      in: 1610612736,
      out: 209715200
    },
    pdp_ip0: {
      inCurrentSpeed: 125000,
      outCurrentSpeed: 12500,
      inMaxSpeed: 1250000,
      outMaxSpeed: 250000,
      in: 104857600,
      out: 10485760
    },
    lo0: { in: 999999999, out: 999999999 }
  };
  const trafficAuto = await runScript('MadsDash-Traffic-v3.js', {
    $trigger: 'auto-interval',
    $network: { wifi: { ssid: 'KK-Public' } },
    $persistentStore: {
      read: key => trafficStore[key] || null,
      write: (value, key) => { trafficStore[key] = value; return true; }
    },
    $httpAPI: (_method, apiPath, _body, callback) => {
      assert.strictEqual(apiPath, '/v1/traffic');
      callback({ interface: trafficMap });
    }
  });
  assert(trafficAuto.content.includes('10.0 Mbps'));
  assert(trafficAuto.content.includes('Wi-Fi · en0 · refresh cycles'));

  const trafficManual = await runScript('MadsDash-Traffic-v3.js', {
    $trigger: 'button',
    $network: { wifi: { ssid: 'KK-Public' } },
    $persistentStore: {
      read: key => trafficStore[key] || null,
      write: (value, key) => { trafficStore[key] = value; return true; }
    },
    $httpAPI: (_method, _apiPath, _body, callback) => callback({ interface: trafficMap })
  });
  assert(trafficManual.content.includes('Cellular · pdp_ip0 · refresh cycles'));

  const correlatorStore = {};
  const healthyMap = {
    'https://cp.cloudflare.com/generate_204': [{ status: 204 }, ''],
    'https://captive.apple.com/hotspot-detect.html': [{ status: 200 }, '<TITLE>Success</TITLE>'],
    'https://api.openai.com/v1/models': [{ status: 401 }, '{}']
  };
  const correlatorContext = (network, responses, extra = {}) => ({
    ...extra,
    $network: network,
    $persistentStore: {
      read: key => correlatorStore[key] || null,
      write: (value, key) => { correlatorStore[key] = value; return true; }
    },
    $httpClient: {
      get: (options, callback) => {
        const [response, body, error] = responses[options.url];
        setImmediate(() => callback(error || null, response, body));
      }
    },
    setImmediate,
    setTimeout: fn => fn()
  });

  const wifi = {
    wifi: { ssid: 'KK-Public' },
    v4: { primaryAddress: '10.0.0.2', primaryRouter: '10.0.0.1' },
    v6: {}, dns: ['1.1.1.1', '8.8.8.8']
  };
  const baseline = await runScript('MadsDash-ChangeCorrelator-v3.js', correlatorContext(wifi, healthyMap));
  assert(baseline.content.includes('Healthy · 3/3'));
  assert(baseline.content.includes('Baseline created'));
  assert(baseline.content.includes('read-only'));

  const degradedMap = { ...healthyMap, 'https://api.openai.com/v1/models': [null, '', 'timeout'] };
  const cellular = {
    'cellular-data': { radio: 'LTE', carrier: 'TDC' },
    v4: { primaryAddress: '10.20.0.2', primaryRouter: '10.20.0.1' },
    v6: { primaryAddress: '2001:db8::2' }, dns: ['9.9.9.9']
  };
  await runScript('MadsDash-ChangeCorrelator-v3.js', correlatorContext(cellular, degradedMap, {
    $event: { name: 'network-changed' }
  }));
  const changedPanel = await runScript('MadsDash-ChangeCorrelator-v3.js', correlatorContext(cellular, degradedMap));
  assert(changedPanel.content.includes('Path change + degradation'));
  assert(changedPanel.content.includes('Wi-Fi → Cellular'));

  const secretNotice = 'Profile reload token=do-not-store';
  await runScript('MadsDash-ChangeCorrelator-v3.js', correlatorContext(cellular, healthyMap, {
    $event: { name: 'notification', data: { title: secretNotice } }
  }));
  assert(!correlatorStore['MadsDash.ChangeCorrelator.v3'].includes(secretNotice));
  assert(correlatorStore['MadsDash.ChangeCorrelator.v3'].includes('Message content not retained'));

  const storedCorrelator = JSON.parse(correlatorStore['MadsDash.ChangeCorrelator.v3']);
  assert(storedCorrelator.events.length <= 12);

  console.log('v3 mock tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
