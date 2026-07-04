#!/bin/sh
# Seed the `restorm-kafka` broker with a deterministic fixture: a single
# topic (`restorm-test`, 1 partition so offset/seek assertions stay simple)
# pre-loaded with 3 messages. Run once by the `kafka-seed` compose service
# after the broker's healthcheck passes — idempotent (topic creation is a
# no-op if it already exists, e.g. on a `docker compose up` re-run against a
# volume-less broker that just restarted empty).
#
# To refresh the fixture: edit the three `kafka-console-producer.sh` lines
# below and re-run `docker compose up --force-recreate kafka-seed`.
set -e

# `kafka-seed` runs with `network_mode: host` (see docker-compose.yml) so
# `localhost:9092` here is the same published broker port restorm itself
# connects to — matching the broker's `PLAINTEXT://localhost:9092`
# advertised listener, which a compose-network alias (`kafka:9092`) would
# not resolve back to after the initial bootstrap metadata fetch.
BROKER=localhost:9092
TOPIC=restorm-test

/opt/kafka/bin/kafka-topics.sh --bootstrap-server "$BROKER" \
  --create --if-not-exists --topic "$TOPIC" --partitions 1 --replication-factor 1

printf 'seed-message-1\nseed-message-2\nseed-message-3\n' | \
  /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server "$BROKER" --topic "$TOPIC"

echo "Seeded topic '$TOPIC' with 3 messages."
