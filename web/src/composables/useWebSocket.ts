import { ref, onMounted, onUnmounted } from 'vue';

export interface TelemetryMessage {
  type: string;
  device_id?: string;
  timestamp?: string;
  [key: string]: any;
}

export function useWebSocket(onMessage?: (data: TelemetryMessage) => void) {
  const isConnected = ref(false);
  let socket: WebSocket | null = null;
  let reconnectTimer: any = null;

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws`;

    try {
      socket = new WebSocket(url);

      socket.onopen = () => {
        isConnected.value = true;
        console.log('[useWebSocket] Connected to', url);
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (onMessage) onMessage(data);
        } catch (err) {
          console.error('[useWebSocket] JSON parse error:', err);
        }
      };

      socket.onclose = () => {
        isConnected.value = false;
        console.log('[useWebSocket] Closed, reconnecting in 3s...');
        reconnectTimer = setTimeout(connect, 3000);
      };

      socket.onerror = (err) => {
        console.warn('[useWebSocket] Error:', err);
        socket?.close();
      };
    } catch (err) {
      console.error('[useWebSocket] Connection failed:', err);
      reconnectTimer = setTimeout(connect, 3000);
    }
  }

  onMounted(() => {
    connect();
  });

  onUnmounted(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket) socket.close();
  });

  return {
    isConnected,
  };
}
