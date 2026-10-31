# MAPS 6.0 Central Server (MAPS-server)

MAPS (Mobile Air Pollution Surveillance) 中央監控伺服器，負責集中採集、儲存與視覺化 MAPS 6.0 各站點環境監測盒子的即時與歷史感測數據。

## 架構總覽

```
┌────────────────────────────────────────────────────────┐
│             Docker Compose Stack (server/)             │
│                                                        │
│   [ maps6-web ]      : Nginx (Port 80)                 │
│                      ├── Vue 3 + Chart.js 管理後台     │
│                      └── 反向代理 /api 至 app:3000     │
│                                                        │
│   [ maps6-app ]      : Bun 1.4 + Hono (Port 3000)      │
│                      ├── 原生 Bun SQL 連線池           │
│                      ├── MQTT 雙向命令發送與資料訂閱   │
│                      ├── REST API & CSV 歷史補傳       │
│                      └── Plugin 架構 (含 Discord Bot)  │
│                                                        │
│   [ maps6-mosquitto ]: Eclipse Mosquitto 2.0 (1883)    │
│                      └── MQTT Broker (帳密驗證+持久化) │
│                                                        │
│   [ maps6-postgres ] : PostgreSQL 18-Alpine (5432)     │
│                      └── 盒子清單、設定檔與時序數據庫   │
└────────────────────────────────────────────────────────┘
```

## 快速啟動

```bash
# 複製環境變數設定
cp .env.example .env

# 啟動所有服務 (背景執行)
docker compose up -d

# 查看服務狀態
docker compose ps

# 查看日誌
docker compose logs -f
```

## 服務埠號與存取

- **Web 控制面板**: http://localhost (Port 80)
- **REST API**: http://localhost/api/v1/system/health
- **MQTT Broker**: `localhost:1883` (帳號: `maps` / 密碼: `iisnrl`)
- **PostgreSQL 18**: `localhost:5432` (`maps6` / `maps6_secret`)
