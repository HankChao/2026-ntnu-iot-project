// Explicit simulator. Run against a demo database; stop before collecting experiments.
import mqtt from 'mqtt';
const client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USERNAME || 'maps', password: process.env.MQTT_PASSWORD || 'iisnrl',
});
const topic = process.env.CLOTHES_MQTT_TOPIC || 'clothes/raw';
const count = Number(process.env.SIM_COUNT || 60);
if (!Number.isInteger(count) || count < 1 || count > 3600) throw new Error('SIM_COUNT must be 1..3600');
let timer: ReturnType<typeof setInterval>;
client.on('connect', () => {
  if (timer) return;
  console.log(`SIMULATED DATA -> ${topic}; ${count} messages. Do not mix with real experiments.`);
  let i = 0;
  timer = setInterval(() => {
    if (!client.connected) return;
    const payload = { hx711_raw: Math.round(86000 + 400 * Math.sin(i / 8)),
      ads1115_raw: i % 19 === 18 ? null : Math.round(7800 + 1000 * Math.sin(i / 12)),
      touch_raw: Math.round(31800 + 600 * Math.cos(i / 10)) };
    client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false });
    console.log(JSON.stringify(payload));
    if (++i >= count) { clearInterval(timer); client.end(); }
  }, 1000);
});
client.on('error', (error) => console.error(error.message));
process.on('SIGINT', () => { clearInterval(timer); client.end(true); });
