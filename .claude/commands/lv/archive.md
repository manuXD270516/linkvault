---
description: Archiva el change activo y prepara el commit final
argument-hint: [nombre-del-change]
---
Change: "$ARGUMENTS" (si vacío, el activo). Verifica que tasks.md esté 100% marcado y que la última corrida de tests esté en verde
(si no, detente y dímelo). Ejecuta /opsx:archive, luego `openspec validate --all`, y propone el mensaje de commit
`feat(<área>): <resumen>` listando los archivos. No hagas push.
