# Snippet: Traefik access logs without query strings (ADR-033 D2).
#
# Invite codes travel as `?codigo=` on `/unirse` (also sensitive query on `/login` and
# `/registro`). Traefik's default CLF line includes the full RequestURI with query.
# Use JSON access logs and **drop RequestURI** so only RequestPath (path without query)
# remains. Applied globally — safer than per-route filters and satisfies the SPA routes.
#
# Equivalent CLI flags on the traefik service (see docker-compose.prod.yml):
#
#   --accesslog=true
#   --accesslog.format=json
#   --accesslog.filepath=/var/log/traefik/access.log
#   --accesslog.fields.defaultmode=keep
#   --accesslog.fields.names.RequestURI=drop
#
# Verify after deploy:
#   docker compose -f docker-compose.prod.yml exec traefik \
#     wget -qO- http://127.0.0.1:8080/api/http/routers  # or inspect the log file
#   # After hitting /unirse?codigo=secret, the access.log line MUST NOT contain "codigo=".
