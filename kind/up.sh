#!/usr/bin/env bash
#
# The registry, appshell-controller and Argo CD on a kind cluster of their own, with acme/portal kept
# at the state git declares. kind/README.md walks through it. Run it from anywhere in the
# repository, and again after any change: everything it does is safe to repeat.
#
#   kind/up.sh
#
# Argo CD follows your clone's origin, on the branch you're on, so fork the repository and clone
# your fork: then the portal follows what you push. REPO_URL and REVISION choose another.
#
# It names its context on every command, and leaves your current context as it was. Remove it all
# with:
#
#   kind delete cluster --name appshell
set -euo pipefail

cd "$(dirname "$0")/.."

cluster=${KIND_CLUSTER:-appshell}
context="kind-${cluster}"

# Pinned, so what this installs changes only by a commit here. Argo CD's manifest is checked
# against its checksum; the charts are signed (README.md, Checking the images).
registry_chart_version=1.1.1
controller_chart_version=0.2.0
argocd_version=v3.6.3
argocd_sha256=22b404352546b3bd000cd8354de793e8ca748fc8f3b2798cefe397dc4cafef27

k() { kubectl --context "$context" "$@"; }
h() { helm --kube-context "$context" "$@"; }
step() { printf '\n== %s\n' "$*"; }
fail() {
  echo "$*" >&2
  exit 1
}

for tool in docker kind kubectl helm git curl openssl shasum; do
  command -v "$tool" > /dev/null || fail "kind/up.sh needs $tool."
done

# Where Argo CD reads the portal's state from: a URL it can fetch without credentials.
origin=$(git remote get-url origin 2> /dev/null || true)
case "$origin" in
  git@github.com:*) origin="https://github.com/${origin#git@github.com:}" ;;
esac
repo_url=${REPO_URL:-$origin}
revision=${REVISION:-$(git rev-parse --abbrev-ref HEAD)}
[ -n "$repo_url" ] || fail "There's no origin remote to follow: set REPO_URL to your fork."
[ "$revision" != HEAD ] || fail "You're not on a branch: set REVISION to the branch or commit to follow."

# The seed image compose.yaml names, so both run the same one.
seed_image=$(docker compose --profile seed config --images | grep self-hosted-seed)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

step "A kind cluster, $cluster"
if ! kind get clusters 2> /dev/null | grep -qx "$cluster"; then
  for port in 7150 8080 8081; do
    if (exec 3<> "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then
      fail "Port $port is taken. The Compose demo uses 7150 and 8080: stop it first with 'docker compose down'."
    fi
  done
  # The clone's bundles/ directory, mounted into the node, by its absolute path.
  sed "s|REPOSITORY|$(pwd)|" kind/cluster.yaml > "$work/cluster.yaml"
  previous=$(kubectl config current-context 2> /dev/null || true)
  kind create cluster --name "$cluster" --config "$work/cluster.yaml" ${KIND_NODE_IMAGE:+--image "$KIND_NODE_IMAGE"} --wait 120s
  # kind makes the new cluster your current context. Yours may be one where a mistake costs more.
  [ -z "$previous" ] || kubectl config use-context "$previous" > /dev/null
fi

# A seed image built here, by `docker compose build seed`, is the one to run; otherwise the
# cluster pulls the published one.
if docker image inspect "$seed_image" > /dev/null 2>&1; then
  kind load docker-image --name "$cluster" "$seed_image"
fi

step "MongoDB, Keycloak and the bundles server"
for namespace in appshell appshell-system argocd; do
  k create namespace "$namespace" --dry-run=client -o yaml | k apply -f - > /dev/null
done
k -n appshell create configmap keycloak-realm --from-file=keycloak/appshell-realm.json \
  --dry-run=client -o yaml | k apply -f -
if ! k -n appshell get secret registry > /dev/null 2>&1; then
  k -n appshell create secret generic registry \
    --from-literal=MONGO_URI='mongodb://mongodb:27017/appshell-registry?directConnection=true' \
    --from-literal=GRANT_SECRET="$(openssl rand -hex 32)"
fi
k -n appshell apply -f kind/appshell.yaml
for deployment in mongodb keycloak bundles; do
  k -n appshell rollout status "deployment/$deployment" --timeout 300s
done

step "The registry, from its chart, $registry_chart_version"
h upgrade --install appshell-registry oci://ghcr.io/appshellhq/charts/appshell-registry \
  --version "$registry_chart_version" --namespace appshell -f kind/registry.values.yaml --wait --timeout 5m

step "appshell-controller, from its chart, $controller_chart_version"
h upgrade --install appshell-controller oci://ghcr.io/appshellhq/charts/appshell-controller \
  --version "$controller_chart_version" --namespace appshell-system -f kind/controller.values.yaml \
  --wait --timeout 5m

step "Seed it, and trust the controller with acme/portal"
# The issuer this cluster's service-account tokens carry, which the trust record names.
issuer=$(k get --raw /.well-known/openid-configuration | sed -E 's/.*"issuer":"([^"]+)".*/\1/')
k -n appshell delete job seed --ignore-not-found --wait > /dev/null
sed -e "s|SEED_IMAGE|${seed_image}|" -e "s|CLUSTER_ISSUER|${issuer}|" kind/seed.yaml | k -n appshell apply -f -
outcome=""
for _ in $(seq 1 120); do
  outcome=$(k -n appshell get job seed -o jsonpath='{.status.conditions[?(@.status=="True")].type}')
  case "$outcome" in *Complete* | *Failed*) break ;; esac
  sleep 5
done
k -n appshell logs job/seed --tail 20
case "$outcome" in *Complete*) ;; *) fail "The seed didn't finish: $outcome" ;; esac

step "Argo CD, $argocd_version"
curl -fsSLo "$work/argocd.yaml" "https://raw.githubusercontent.com/argoproj/argo-cd/${argocd_version}/manifests/install.yaml"
echo "${argocd_sha256}  $work/argocd.yaml" | shasum -a 256 -c - > /dev/null \
  || fail "Argo CD's install.yaml isn't the one this script was checked against."
# Argo CD pulls Redis from public.ecr.aws, which refuses anonymous pulls often enough
# ("toomanyrequests") to fail an install. The same image, by its digest, from Google's mirror of
# Docker Hub instead.
redis_ecr=public.ecr.aws/docker/library/redis:8.10.1-alpine
redis_mirror=mirror.gcr.io/library/redis:8.10.1-alpine@sha256:ef216d85ec44f4fdf7c0e6df2d1757a4734ed32fbb278cabd3181b5a27353b79
grep -q "image: ${redis_ecr}$" "$work/argocd.yaml" || fail "Argo CD's install.yaml no longer names ${redis_ecr}."
sed "s|image: ${redis_ecr}$|image: ${redis_mirror}|" "$work/argocd.yaml" > "$work/argocd-mirrored.yaml"
mv "$work/argocd-mirrored.yaml" "$work/argocd.yaml"
# Its settings first, so it starts with them: the demo's, and the controller chart's health check
# for AppshellApplications, which makes Argo CD report what the controller did.
k -n argocd apply --server-side --field-manager appshell-kind -f kind/argocd.yaml
h pull oci://ghcr.io/appshellhq/charts/appshell-controller --version "$controller_chart_version" \
  --untar --untardir "$work" > /dev/null
k -n argocd create configmap argocd-cm --dry-run=client -o yaml \
  --from-file=resource.customizations.health.registry.appshell.org_AppshellApplication="$work/appshell-controller/argocd/health.lua" \
  | k -n argocd apply --server-side --field-manager appshell-kind-health -f -
k -n argocd apply --server-side --force-conflicts -f "$work/argocd.yaml" > /dev/null
k -n argocd wait --for=condition=Available deployment --all --timeout 300s
k -n argocd rollout status statefulset/argocd-application-controller --timeout 300s

step "Argo CD follows kind/gitops in $repo_url, at $revision"
k -n argocd apply -f - << EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: acme-portal
spec:
  project: default
  source:
    repoURL: ${repo_url}
    targetRevision: ${revision}
    path: kind/gitops
  destination:
    server: https://kubernetes.default.svc
    namespace: acme
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
EOF

step "The controller applies what git declares"
for _ in $(seq 1 60); do
  k -n acme get appshellapplication portal > /dev/null 2>&1 && break
  sleep 5
done
k -n acme wait --for=condition=Ready appshellapplication/portal --timeout 300s

cat << EOF

The portal:  http://localhost:7150/a/acme/portal
Argo CD:     http://localhost:8081, as admin, with the password this prints:
             kubectl --context $context -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
Its state:   kind/gitops/portal.yaml, at $revision in $repo_url
EOF
case "$repo_url" in
  */appshellhq/appshell-self-hosted | */appshellhq/appshell-self-hosted.git)
    echo
    echo "Argo CD follows appshellhq/appshell-self-hosted, which you can't push to. To change the portal"
    echo "in git, fork it, clone your fork, and run kind/up.sh from there."
    ;;
esac
