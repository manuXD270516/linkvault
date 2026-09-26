## 1. Tests en rojo [frontend]

- [x] 1.1 En `discovery.page.spec.ts`, test «saves to a group and the confirmation names that group»: guardar con destino
      «Demo LatAm» y comprobar que `discovery-save-created` contiene «Demo LatAm» y no «Solo para mí»; correrlo y
      **verlo fallar** contra el código actual (se anota la salida del fallo)
      — Rojo visto el 2026-09-26: `AssertionError: expected ' Guardada en «Solo para mí». ' to contain 'Demo LatAm'`
- [x] 1.2 En `discovery.page.spec.ts`, test «saves privately and the confirmation names Solo para mí»: guardar con destino
      privado y comprobar que `discovery-save-created` contiene «Solo para mí»; verificar que corre (pasa ya: es la
      protección de no regresión del caso privado)
- [x] 1.3 En `discovery.page.spec.ts`, tests de «Guardar en un grupo que ya la tenía» (`discovery-save-already` contiene
      «Demo LatAm» y no «Ya la tenías»), «Cambiar el destino después de guardar» (tras el created, `setSaveDestination(null)`
      y la confirmación sigue nombrando el grupo) y «Grupo del guardado ya no disponible» (tras el created,
      `GroupsStore.load()` con flush `[]`: la confirmación dice «el grupo» y no «Solo para mí», y su variante con
      `already_there`: `discovery-save-already` dice «el grupo» y no «Ya la tenías»); verlos fallar
- [x] 1.4 En `discovery.store.spec.ts`: ampliar el test de guardado en grupo para que compruebe `saveDestinations()[url]`
      igual al grupo, y test «run durante un save en vuelo: si el resultado reaparece, su destino es el grupo»; verlos
      fallar (typecheck o aserción)
      — Rojo visto: `TS2551: Property 'saveDestinations' does not exist`; con el store hecho y la plantilla sin tocar,
      los cinco tests de 1.1/1.3 cayeron por la aserción esperada y 1.2 pasó (27 tests, 5 rojos)

## 2. Destino real en la confirmación [frontend]

- [x] 2.1 `DiscoveryStore`: estado `saveDestinations` escrito en el mismo `patchState` que el resultado (try y catch) con
      el `groupId` capturado al click, limpiado en `run` y al reintentar la URL (D1); verificar que pasan los tests de 1.4
- [x] 2.2 `DiscoveryPage` + plantilla: resolver el nombre del grupo desde `GroupsStore.groups()` y pintar los seis textos
      de D3 conservando los `data-testid`; verificar que pasan todos los tests de §1 y los existentes del spec
- [x] 2.3 i18n (D4): `pnpm nx run web:extract-i18n` y traducciones EN de las cuatro entradas nuevas en `messages.en.xlf`;
      verificar con `pnpm nx run web:i18n-check` y con
      `rg -A3 'id="discovery\.save\.(created|already)InGroup"' apps/web/src/locale/messages.en.xlf` que la línea
      `<target>` de cada una contiene `<x id="INTERPOLATION"`

## 3. Docs y verificación

- [x] 3.1 Retirar la fila de `web/discovery` de «No encontrado en el código» en `docs/catalogo-de-uso.md` y ajustar el
      «Qué esperar» de su recorrido de discovery si cita la confirmación; verificar con grep que no queda la cita fija
- [x] 3.2 `pnpm nx affected -t lint,typecheck,test,i18n-check --base=main` en verde
