# Upstream distributes the community server as source; pin the security release.
FROM golang:1.25-alpine AS build
RUN apk add --no-cache ca-certificates git
RUN CGO_ENABLED=0 GOBIN=/out go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z \
    && cp /go/pkg/mod/github.com/minio/minio@*/LICENSE /out/LICENSE

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && adduser -D -u 10001 minio \
    && mkdir -p /data /licenses \
    && chown minio:minio /data
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /out/LICENSE /licenses/minio-LICENSE
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
