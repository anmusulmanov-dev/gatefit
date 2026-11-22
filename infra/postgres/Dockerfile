# syntax=docker/dockerfile:1
# PostgreSQL 16 with WAL-G, for production (docs/RUNBOOK.md). WAL-G ships every finished
# WAL segment and a nightly base backup to an external S3 bucket, so the database can be
# brought back to any moment, not only to the last dump. Debian, not Alpine: the WAL-G
# release binaries are built against glibc.
FROM postgres:16-bookworm

ARG WALG_VERSION=v3.0.9
ARG WALG_SHA256=d6795c663894d836ba20840bffe8970aed81bbe25d3151bd4951f6f9c362def9

ADD --checksum=sha256:${WALG_SHA256} \
  https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-amd64 \
  /usr/local/bin/wal-g
RUN chmod 0755 /usr/local/bin/wal-g && wal-g --version

# WAL-G reads its bucket and keys from the container's environment; the archiving
# settings are on the command line in infra/docker-compose.prod.yml.
COPY wal-g.sh /usr/local/bin/wal-g.sh
RUN chmod 0755 /usr/local/bin/wal-g.sh
