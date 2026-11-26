# appshell on kind, kept at what git declares

The Compose demo's registry, on a Kubernetes cluster of its own, with acme/portal kept at the state
a file in git declares. Push a change to that file, and the portal follows: Argo CD syncs it into
the cluster, and [appshell-controller](https://github.com/appshellhq/appshell-controller) applies
it to the registry with its own workload identity, with no credential stored anywhere.

## What you need

- **Docker,** with [kind](https://kind.sigs.k8s.io/), kubectl and [Helm](https://helm.sh/) 3.16
  or later.
- **Your own fork of this repository,** cloned. Argo CD follows your clone's origin, on the branch
  you're on, so the portal follows what you push. It reads the fork anonymously, so leave it
  public.
- **Ports 7150, 8080 and 8081 free.** The registry and Keycloak use the Compose demo's ports, so
  the walkthrough's addresses work unchanged: stop that demo first, with `docker compose down`.

## Start it

From your clone:

```sh
kind/up.sh
```

It makes a kind cluster named `appshell`, and leaves your current kubectl context as it was. Then
it installs, as the Compose demo runs them, MongoDB, Keycloak with the demo's realm, and a server
for packages' files, and the rest from their published, signed charts:

- **The registry,** which trusts this cluster's workloads to apply applications whose owners trust
  them.
- **appshell-controller,** which applies each AppshellApplication to the registry.
- **The seed,** which publishes acme's layout and pages, applies acme/portal, and trusts the
  controller with it.
- **Argo CD,** following `kind/gitops` in your fork.

It ends with the addresses below. Run it again after any change: everything it does is safe to
repeat.

## Walk through it

The commands name the cluster's context, `kind-appshell`, so they never touch another cluster.

### 1. Look at the portal

Open <http://localhost:7150/a/acme/portal>. Its accent is steel. That comes from
[`gitops/portal.yaml`](gitops/portal.yaml), which declares the whole portal: its shell, its theme,
and every package it activates.

### 2. See what keeps it there

```sh
kubectl --context kind-appshell -n acme get appshellapplication portal
```

`READY` is `True`: the controller applied this spec to the registry. Argo CD shows the same, at
<http://localhost:8081>. Sign in as `admin`, with the password `kind/up.sh` printed the command for.
`acme-portal` is `Synced` and `Healthy`. Healthy is the controller's verdict: Argo CD reads it from
the resource's status.

### 3. Change it in git

In `kind/gitops/portal.yaml`, change the accent:

```yaml
    theme:
      base: neutral
      accent: emerald
```

Commit and push. Argo CD looks at your fork every thirty seconds. Watch the resource:

```sh
kubectl --context kind-appshell -n acme get appshellapplication portal --watch
```

When it's `READY` again, reload the portal: it's emerald. Nobody ran a command against the
registry, and no secret was used. The controller presents its own service-account token, minted
for the registry, which trusts it because the portal's owner said so.

### 4. Push something the registry refuses

Pin a version of a package that was never published, `acme/orders@9.9.9`, and push. The
controller's apply is refused, so the resource goes `READY` `False`, and Argo CD shows
`acme-portal` as `Degraded`, with the registry's reason. The portal still serves what it had: a
refused change never half-lands. Put `1.0.0` back and push again.

### 5. Change it around git

Change the resource by hand:

```sh
kubectl --context kind-appshell -n acme patch appshellapplication portal --type merge \
  -p '{"spec":{"shell":{"title":"Changed by hand"}}}'
```

Within thirty seconds Argo CD puts git's version back, and the controller applies it. Git is
where the portal's state comes from. A change made in the registry around the controller is
undone too, within a minute.

### 6. The rest of the walkthrough

The Compose walkthrough's steps 2 to 8 work here unchanged, from the repository's root: sign in as
alice, copy the portal into her scope, develop a page, publish it, and keep code private. Its
addresses are this registry's.

## How it fits together

- **Git, then Argo CD.** `kind/gitops` holds an AppshellApplication. Argo CD syncs it into the
  `acme` namespace and reverts any change made there by hand.
- **The controller.** It applies each AppshellApplication to the registry at
  `http://appshell-registry.appshell.svc`, with a token the kubelet mints for that registry's deploy
  audience and rotates. It applies again every minute, which reverts a change made in the registry.
- **The registry.** It trusts this cluster's service-account issuer, which it reads from the API
  server (`TRUSTED_DEPLOYMENT_LOCAL_CLUSTER`). It applies an application for a workload only if one
  of the application's owners trusts that workload. The seed, acme's owner, trusts the controller
  with acme/portal and nothing else.
- **Everything else** is as in Compose: [`appshell.yaml`](appshell.yaml),
  [`registry.values.yaml`](registry.values.yaml) and [`controller.values.yaml`](controller.values.yaml)
  say how.

## Stopping and starting over

```sh
kind delete cluster --name appshell
```

## Troubleshooting

- **The resource says `NotTrusted`:** the seed hasn't trusted the controller with the portal. Run
  `kind/up.sh` again; it runs the seed again.
- **Argo CD can't fetch your fork:** it reads it anonymously, so a private fork needs credentials
  added to Argo CD.
- **A port is taken:** stop the Compose demo, `docker compose down`, or whatever else holds 7150,
  8080 or 8081.
