#!/usr/bin/env bash
#
# Stage 2 of the spike on a kind cluster that already runs APISIX with its ingress controller.
# Run it from the repository root, and again after any change:
#
#   spike/kind/up.sh
#
# Everything it makes is in the appshell-spike namespace. Remove it with:
#
#   kubectl --context dev delete namespace appshell-spike
#
# It names its context on every command and never changes the current one.
set -euo pipefail

context=${KUBE_CONTEXT:-dev}
cluster=${KIND_CLUSTER:-desktop}
namespace=appshell-spike

k() { kubectl --context "$context" "$@"; }

# Only ever a kind cluster: the manifests carry demo accounts.
actual=$(kubectl config view -o jsonpath="{.contexts[?(@.name==\"$context\")].context.cluster}")
if [ "$actual" != "kind-$cluster" ]; then
  echo "Context '$context' is cluster '$actual', not kind-$cluster. Set KUBE_CONTEXT and KIND_CLUSTER." >&2
  exit 1
fi

docker build -t appshell-spike-research:local spike/research
docker build -t appshell-spike-seed:local -f seed/Dockerfile .

# The registry's image is built from appshell-services: this machine's Docker can't pull the
# published one.
kind load docker-image --name "$cluster" \
  appshell-spike-research:local appshell-spike-seed:local appshell/registry:local

k apply -f spike/kind/namespace.yaml

# Generated once and kept in the cluster only: the gateway's client and session secrets, and
# what signs the registry's grants, the app's session cookie and Keycloak's admin.
if ! k -n "$namespace" get secret spike-oidc >/dev/null 2>&1; then
  k -n "$namespace" create -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: spike-oidc
stringData:
  client_id: spike-gateway
  client_secret: $(openssl rand -hex 32)
  session.secret: $(openssl rand -hex 16)
---
apiVersion: v1
kind: Secret
metadata:
  name: spike-secrets
stringData:
  keycloak-admin-password: $(openssl rand -hex 24)
  grant-secret: $(openssl rand -hex 32)
  storage-secret: $(openssl rand -hex 32)
EOF
fi

# The demo's realm, as it is in this repository.
k -n "$namespace" create configmap keycloak-realm --from-file=keycloak/appshell-realm.json \
  --dry-run=client -o yaml | k apply -f -

# A job can't be changed once made, and both are safe to run again.
k -n "$namespace" delete job gateway-client seed --ignore-not-found

k apply -k spike/kind

# Pods keep the image they started with, and these tags don't change with their content.
k -n "$namespace" rollout restart deployment/research deployment/bundles

for deployment in mongodb keycloak bundles registry research; do
  k -n "$namespace" rollout status "deployment/$deployment" --timeout=300s
done
k -n "$namespace" wait --for=condition=complete job/gateway-client job/seed --timeout=600s

echo
echo "Open https://spike.local.appshell.org/a/acme/portal/research and sign in as alice / alice."
