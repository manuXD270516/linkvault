## 1. Reproducir y acotar el defecto

- [ ] 1.1 [infra] Dejar anotado en el change el procedimiento de reproducción local del fallo (`pnpm nx build api --configuration=production`, después el install de producción en `dist/apps/api`) con la salida literal del error; verificar que el error reproducido es `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE` sobre `packageManagerDependencies` y no otro.
- [ ] 1.2 [infra] Comprobar que `worker` reproduce exactamente el mismo fallo con el mismo procedimiento, y anotar si su manifiesto generado también trae `packageManager`; verificar con la salida guardada en un archivo.
- [ ] 1.3 [infra] Comprobar si `web` está afectado (su Dockerfile no tiene etapa de dependencias de producción) y dejar escrito por qué sí o por qué no, para que el arreglo no se aplique a ciegas donde no hace falta.

## 2. Arreglar el build de las imágenes

- [ ] 2.1 [infra] En `docker/api.Dockerfile`, retirar `packageManager` del manifiesto generado antes del install de producción, **conservando `--frozen-lockfile`**; verificar construyendo la imagen localmente hasta que esa capa termine con éxito.
- [ ] 2.2 [infra] Lo mismo en `docker/worker.Dockerfile`; verificar con el build local de esa imagen.
- [ ] 2.3 [infra] Dejar un comentario en ambos Dockerfiles que diga **por qué** se retira ese campo y qué pasa si alguien lo quita del arreglo (vuelve el fallo), para que no se lea como una línea arbitraria y se borre en la próxima limpieza.
- [ ] 2.4 [infra] Comprobar que el arreglo **no** desactiva la reproducibilidad: verificar que el install sigue exigiendo el bloqueo y que alterar a mano una versión del lockfile generado hace fallar el build.

## 3. Verificar que la imagen arranca

- [ ] 3.1 [infra] Escribir un compose de verificación —o el equivalente en el workflow— que levante la imagen de `api` recién construida junto a mongo y redis, sin necesitar ningún secreto de despliegue; verificar levantándolo en local contra la imagen construida en el grupo 2.
- [ ] 3.2 [infra] Comprobar readiness de verdad: `GET /health` respondiendo con sus comprobaciones de mongo y redis, no un `200` cualquiera ni HTML; verificar que la comprobación **falla** si se apaga redis.
- [ ] 3.3 [infra] Comprobar que la verificación **cae** cuando la imagen no arranca: romper a mano el `entrypoint` o el artefacto, ver fallar el paso nombrando que la imagen no arranca, y restaurar. Sin esta comprobación, el paso nuevo repetiría el problema que este change corrige.
- [ ] 3.4 [infra] Acotar el paso con un plazo y con la recogida de los logs del contenedor cuando falle, para que un fallo en CI sea diagnosticable sin repetirlo a mano.
- [ ] 3.5 [infra] Decidir e implementar la verificación de arranque de `worker` según lo que cierre el debate (Q1 del diseño); verificar del mismo modo que el paso cae si el proceso muere.

## 4. Tres resultados honestos en el CD

- [ ] 4.1 [infra] En `.github/workflows/cd-staging.yml`, separar la construcción y verificación del artefacto del intento de despliegue, de modo que lo primero ocurra siempre y lo segundo solo con destino configurado; verificar con una corrida real en la rama del change.
- [ ] 4.2 [infra] Implementar el caso "sin destino": el workflow termina **en verde** informando de forma visible que no se desplegó y por qué, sin afirmar en ningún punto que sí; verificar en la corrida real, que hoy no tiene secretos.
- [ ] 4.3 [infra] Implementar el caso "destino a medias": si hay algún secreto de destino pero faltan otros, el workflow **falla** nombrando los que faltan, porque ahí alguien sí quería desplegar; verificar con un secreto de prueba puesto y el resto ausente, y retirarlo después.
- [ ] 4.4 [infra] Comprobar que un artefacto roto **rompe** el pipeline aunque no haya destino: el fallo del artefacto no puede quedar tapado por la rama de "no hay dónde desplegar"; verificar rompiendo el build a propósito en una corrida y restaurando.
- [ ] 4.5 [infra] Aplicar la misma estructura a `.github/workflows/cd-prod.yml`, que **nunca se ha ejecutado**; verificar con una corrida sobre un tag de prueba y borrarlo después.
- [ ] 4.6 [infra] Repasar que ningún paso del CD siga afirmando "desplegado" en su nombre o en su resumen cuando solo verificó; verificar leyendo los nombres de los jobs y pasos tal y como se ven en la interfaz.

## 5. La documentación deja de mentir, y se comprueba sola

- [ ] 5.1 [infra] Corregir los cuatro sitios del RUNBOOK (`:468`, `:558`, `:709`, `:929`) que afirman que no existe el borrado de cuenta: nombrar `DELETE /api/users/me` como el camino, y dejar el procedimiento manual como excepción diciendo qué sustituye; verificar que ningún otro punto del RUNBOOK repite la afirmación.
- [ ] 5.2 [infra] Escribir la comprobación automatizada que falla si la documentación vuelve a afirmar que el borrado de cuenta no existe mientras el caso de uso siga en el código; verificar que **cae** reintroduciendo la frase a mano, y restaurar.
- [ ] 5.3 [infra] Corregir `.env.example:166` para que `BYOK_OPENROUTER_MODEL` apunte a un modelo verificado, y anotar la verificación donde se opera; verificar que el valor coincide con el que el RUNBOOK da por comprobado.
- [ ] 5.4 [infra] Escribir la comprobación que falla si un valor por defecto del ejemplo es uno que la documentación declara inservible; verificar que **cae** devolviendo el modelo muerto, y restaurar.
- [ ] 5.5 [infra] Documentar `cd-staging` en el RUNBOOK: qué hace, cómo se lee cada uno de los tres resultados y qué hay que configurar para que llegue a desplegar. Hoy el RUNBOOK **no lo menciona**, lo que contribuyó a que nadie mirara veintiún fallos.

## 6. Cierre

- [ ] 6.1 [infra] `docs/adr/ADR-048.md` con lo no trivial: retirar el campo en vez de aflojar el candado y por qué, la verificación del artefacto sin servidor, los tres resultados del CD como **enmienda a ADR-033 D10** (no como contradicción), y la regla general de que una afirmación sobre lo que el producto no hace se comprueba sola. Verificar que el proposal lo referencia.
- [ ] 6.2 [infra] Anotar en `docs/design-v0.2.md` §6 y en `openspec-changes.yaml` lo que este change **no** cierra: sigue sin haber servidor de staging, y los golden sets reales quedan como candidato a la fila 35.
- [ ] 6.3 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `openspec validate --all` en verde, con la salida guardada en un archivo.
- [ ] 6.4 [infra] **La comprobación que da sentido al change**: `cd-staging` en **verde** sobre la rama, con el artefacto construido y verificado y el aviso visible de que no se desplegó. Adjuntar el enlace de la corrida. No se da por terminado con "el CI pasa".
