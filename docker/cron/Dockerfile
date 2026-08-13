FROM alpine:3.21

RUN apk add --no-cache curl ca-certificates \
 && adduser -D -u 1000 collect

COPY docker/cron/collect.sh /usr/local/bin/collect
RUN chmod +x /usr/local/bin/collect

USER 1000
ENTRYPOINT ["/usr/local/bin/collect"]
