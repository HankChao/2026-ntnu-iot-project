# 常用指令（macOS / Linux）。Windows 請照 README 直接執行 docker compose 指令。
# 注意：這裡沒有、也不要加 `docker compose down -v`，那會刪掉資料庫 volume。

COMPOSE     := docker compose
COMPOSE_DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml
SIM_COUNT   ?= 60
s           ?= app
TC_DIR      := $(HOME)/.cache/iot-server-typecheck

.DEFAULT_GOAL := help
.PHONY: help setup show check env-check dev dev-backend up down restart ps logs \
        test test-app test-web typecheck sim seed smoke

help: ## 列出所有指令
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## 第一次使用：建立 .env、產生 MQTT 密碼
	./scripts/setup.sh

show: env-check ## 印出 ESP32 與 MAPS 盒子要填的 MQTT 設定
	./scripts/setup.sh show

check: env-check ## 確認 MQTT 帳密正確、列出被拒絕的裝置
	./scripts/setup.sh check

env-check:
	@test -f .env || { echo "找不到 .env，請先執行 make setup"; exit 1; }

dev: dev-backend ## 開發模式：後端在 Docker（改檔自動重啟）+ 本機 Vite（http://localhost:5173）
	@echo "後端已啟動；Ctrl-C 只會停掉 Vite，後端要停請用 make down"
	cd web && bun install && bun run dev

dev-backend: env-check ## 只啟動開發模式的後端（mosquitto、postgres、app），不跑 Vite
	@$(COMPOSE) stop web >/dev/null 2>&1 || true
	$(COMPOSE_DEV) up -d --build

up: env-check ## 正式模式：全部在 Docker（http://localhost:8088）
	$(COMPOSE) up -d --build

down: ## 停止所有容器（只停不刪，資料保留）
	$(COMPOSE) stop

restart: ## 重啟 app
	$(COMPOSE) restart app

ps: ## 容器狀態
	$(COMPOSE) ps

logs: ## 追蹤日誌（預設 app，可用 make logs s=postgres）
	$(COMPOSE) logs -f $(s)

test: test-app test-web ## 執行後端測試與前端 build

test-app: env-check ## 後端測試（不需要先啟動服務）
	$(COMPOSE_DEV) run --rm --no-deps -T app bun test

test-web: ## 確認前端能 build
	cd web && bun install && bun run build

typecheck: ## 前端型別檢查（vue-tsc 2.2 + TypeScript 5.8）
	@mkdir -p $(TC_DIR) && test -x $(TC_DIR)/node_modules/.bin/vue-tsc || \
		(cd $(TC_DIR) && bun add vue-tsc@2.2 typescript@5.8 >/dev/null)
	cd web && $(TC_DIR)/node_modules/.bin/vue-tsc --noEmit

sim: ## 送模擬衣夾資料（預設 60 筆，可用 make sim SIM_COUNT=10），需先啟動服務
	$(COMPOSE) exec -T -e SIM_COUNT=$(SIM_COUNT) app bun scripts/publish-clothes.ts

seed: ## 寫入示範資料（衣夾-02～08、衣物、晾衣紀錄，is_demo = true）；已經有就略過，需先啟動服務
	$(COMPOSE) exec -T app bun scripts/seed-demo.ts

smoke: ## 整合測試 MQTT → DB → API（需先啟動服務並建立 tools/config.json，會寫入測試資料）
	@test -f tools/config.json || { echo "找不到 tools/config.json，請先複製 tools/config.example.json 並填好"; exit 1; }
	python3 tools/smoke_clothes.py
	python3 tools/smoke_maps.py
