# Alternativa descartada: staging en Fly.io

Change de OpenSpec **completo y aparcado** que sustituiría a 35b (`staging-host`, Oracle Cloud) por Fly.io. Se evaluó y
se descartó por coste el 2026-09-30: ver [ADR-054](../../adr/ADR-054.md), que dice cuándo reabrirlo.

**No es un change activo.** Vive fuera de `openspec/changes/` a propósito, para que no bloquee ni entre en la secuencia.

| Fichero | Qué es |
|---|---|
| [`proposal.md`](proposal.md) | Por qué y qué cambia |
| [`design.md`](design.md) | Decisiones D1-D12 |
| [`tasks.md`](tasks.md) | Tareas etiquetadas, cada una con su verificación |
| [`specs/platform/fly-deploy/spec.md`](specs/platform/fly-deploy/spec.md) | Capacidad nueva, con escenarios |

## Adoptarlo

```bash
cp -r docs/alternativas/fly-io openspec/changes/staging-host-fly
rm openspec/changes/staging-host-fly/README.md
pnpm exec openspec validate staging-host-fly --strict --no-interactive
```

Después, en este orden:

1. Redactar los MODIFIED pendientes que lista `proposal.md` («Deltas que se escriben al adoptarlo») sobre el texto
   vigente de `openspec/specs/`.
2. `/lv:debate staging-host-fly` y aprobación humana.
3. `/lv:apply`.

El paquete se validó con `openspec validate --strict` copiándolo temporalmente a `openspec/changes/` el 2026-09-30.
