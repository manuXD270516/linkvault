.PHONY: setup context status run auto autopilot mvp up down test
NAME ?= next
setup:      ; bash scripts/setup.sh
context:    ; claude -p "/lv:context"
status:     ; claude -p "/lv:status"
run:        ; bash scripts/change.sh $(NAME) $(ARGS)             # con puertas humanas
auto:       ; bash scripts/change.sh $(NAME) --auto $(ARGS)      # sin puertas
autopilot:  ; bash scripts/autopilot.sh $(ARGS)                  # todos los pendientes, en orden
mvp:        ; bash scripts/autopilot.sh --until applications-tracking
up:         ; docker compose up -d --wait
down:       ; docker compose down
test:       ; AI_CHAIN=mock AI_MOCK_MODE=replay pnpm nx run-many -t lint,typecheck,test,i18n-check
