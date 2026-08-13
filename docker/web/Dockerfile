# nginx-unprivileged : uid 101, écoute sur 8080, compatible readOnlyRootFilesystem
# (pid dans /tmp, cache dans /var/cache/nginx — tous deux montés en emptyDir).
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY site/ /usr/share/nginx/html/
