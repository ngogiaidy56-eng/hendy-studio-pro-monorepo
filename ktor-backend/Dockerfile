FROM gradle:8.12-jdk21 AS build
WORKDIR /workspace
COPY . .
RUN gradle --no-daemon clean installDist

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /workspace/build/install/hendy-ktor-core ./
USER app
ENV KTOR_PORT=8090
EXPOSE 8090
ENTRYPOINT ["./bin/hendy-ktor-core"]
