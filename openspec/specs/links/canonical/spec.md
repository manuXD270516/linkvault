# links/canonical Specification

## Purpose
TBD - created by archiving change job-discovery. Update Purpose after archive.

## Requirements

### Requirement: Platform remoteok

El conjunto de plataformas SHALL incluir `remoteok`. El canonicalizer SHALL producir
`platform: remoteok` y un `externalJobId` estable desde la URL o el id de la API cuando
exista; si no, el save cae en dedupe por `urlHash` como `generic`.

#### Scenario: URL Remote OK se canonicaliza

- **GIVEN** una URL `https://remoteok.com/remote-jobs/<id>-…`
- **WHEN** se canonicaliza
- **THEN** `platform` SHALL ser `remoteok` y `externalJobId` SHALL estar presente cuando el id sea parseable
