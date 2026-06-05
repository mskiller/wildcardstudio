.PHONY: up down logs build test lint

## Start all services
up:
	docker compose up -d

## Stop all services
down:
	docker compose down

## Follow logs
logs:
	docker compose logs -f

## Rebuild images and restart
build:
	docker compose up -d --build

## Run backend tests (inside container)
test:
	docker compose exec backend pytest -v

## Manual backup
backup:
	curl -s -X POST http://localhost/api/sync/backup | python3 -m json.tool

## Open API docs in browser
docs:
	open http://localhost/api/docs 2>/dev/null || xdg-open http://localhost/api/docs

## Git commit wildcards (inside container)
commit:
	curl -s -X POST http://localhost/api/sync/git/commit \
	  -H "Content-Type: application/json" \
	  -d '{"message":"manual commit"}' | python3 -m json.tool
