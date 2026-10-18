// Shared game state over a free public MQTT broker (no account, no key).
// The host's browser owns the game: it applies players' actions and publishes
// the full state as a retained message, so late joiners get it immediately.

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];
const PREFIX = 'strassenjagd-v1/';

function lib() {
  const m = window.mqtt;
  const connect = m && (m.connect || (m.default && m.default.connect));
  if (!connect) throw new Error('MQTT-Bibliothek fehlt');
  return connect;
}

// Opens one connection; resolves once connected or rejects after the timeout.
function open(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = lib()(url, {
      clientId: 'sj-' + Math.random().toString(36).slice(2, 12),
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: timeoutMs,
      keepalive: 30
    });
    const timer = setTimeout(() => { client.end(true); reject(new Error('timeout')); }, timeoutMs + 500);
    client.once('connect', () => { clearTimeout(timer); resolve(client); });
  });
}

export function createNet() {
  let client = null;
  let brokerIndex = -1;
  const handlers = new Map(); // topic filter -> callback
  const listeners = { status: () => {} };

  function matches(filter, topic) {
    if (filter.endsWith('/+')) {
      const base = filter.slice(0, -1);
      return topic.startsWith(base) && !topic.slice(base.length).includes('/');
    }
    return filter === topic;
  }
  function attach(c) {
    c.on('message', (topic, payload) => {
      const text = payload.toString();
      for (const [filter, cb] of handlers) if (matches(filter, topic)) cb(text, topic);
    });
    c.on('offline', () => listeners.status('offline'));
    c.on('reconnect', () => listeners.status('connecting'));
    c.on('connect', () => {
      listeners.status('online');
      // resubscribe after a reconnect (clean session)
      for (const filter of handlers.keys()) c.subscribe(filter, { qos: 1 });
    });
  }

  return {
    get brokerIndex() { return brokerIndex; },
    onStatus(fn) { listeners.status = fn; },
    // Connects to the given broker, or the first one that answers.
    async connect(preferred, override) {
      const list = override ? [override] : BROKERS;
      const order = preferred != null && list[preferred] ? [preferred, ...list.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...list.keys()];
      for (const i of order) {
        if (client && brokerIndex === i) return i;
        try {
          const c = await open(list[i], 6000);
          if (client) client.end(true);
          client = c;
          brokerIndex = i;
          attach(c);
          listeners.status('online');
          return i;
        } catch (_) { /* try the next broker */ }
      }
      throw new Error('Kein Server erreichbar');
    },
    subscribe(topic, cb) {
      const t = PREFIX + topic;
      handlers.set(t, cb);
      client.subscribe(t, { qos: 1 });
      return () => { handlers.delete(t); if (client) client.unsubscribe(t); };
    },
    publish(topic, text, retain) {
      return new Promise((resolve, reject) => {
        client.publish(PREFIX + topic, text, { qos: 1, retain: !!retain }, err => (err ? reject(err) : resolve()));
      });
    }
  };
}
