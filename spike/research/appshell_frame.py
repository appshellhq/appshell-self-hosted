"""What a pip package for NiceGUI apps hosted in appshell would hold (appshellhq/appshell#102).

    import appshell_frame

    appshell_frame.install(host_origins=['https://portal.example.com'])

    @ui.page('/')
    def index():
        appshell_frame.on_host(lambda host: ui.notify(host.vars['DATASET']))
        appshell_frame.on_props(lambda props: ui.notify(props.get('project')))
"""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from nicegui import app, ui

_HERE = Path(__file__).parent


@dataclass(frozen=True)
class Host:
    """What the host said when it answered.

    It arrives from the browser, so it's whatever the browser says it is: fit for how a page
    looks and what it shows first, never for deciding what a user may see.
    """

    vars: dict[str, str | int | float] = field(default_factory=dict)
    color_scheme: str = 'system'
    #: What the container gave this app's slot when the page loaded. See on_props.
    props: dict[str, object] = field(default_factory=dict)


def install(*, host_origins: Sequence[str]) -> None:
    """Puts the bridge on every page, and lets only these origins frame the app."""
    origins = list(host_origins)
    ancestors = ' '.join(origins) if origins else "'none'"

    @app.middleware('http')
    async def only_these_hosts(request, call_next):
        response = await call_next(request)
        response.headers['Content-Security-Policy'] = f'frame-ancestors {ancestors}'
        return response

    bridge = (_HERE / 'bridge.js').read_text().replace('__HOSTS__', json.dumps(origins))
    theme = (_HERE / 'theme.css').read_text()
    ui.add_head_html(f'<style>{theme}</style><script>{bridge}</script>', shared=True)


def on_host(handler: Callable[[Host], None]) -> None:
    """Calls handler in this page once the host has answered. Never, when the app isn't framed."""
    ui.on(
        'appshell_init',
        lambda e: handler(
            Host(
                vars=e.args.get('vars') or {},
                color_scheme=e.args.get('colorScheme', 'system'),
                props=_props(e.args),
            )
        ),
    )


def on_props(handler: Callable[[dict[str, object]], None]) -> None:
    """Calls handler in this page with the props its container gave it: once the host has
    answered, and again each time they change. Never, when the app isn't framed.

    They are JSON, whole each time, and the browser's word: an id among them names what to show,
    and whether this user may see it is still the app's to check.
    """
    ui.on('appshell_init', lambda e: handler(_props(e.args)))
    ui.on('appshell_props', lambda e: handler(_props(e.args)))


def _props(args: dict) -> dict[str, object]:
    props = args.get('props')
    return props if isinstance(props, dict) else {}


def user() -> dict | None:
    """Who the gateway signed in, for the page being built: their userinfo claims, or None.

    Read from X-Userinfo, which the gateway fills from its own session and strips from whatever
    a browser sent. So it's true only while the gateway is the only way in: an app that anything
    else can reach can be told anything.
    """
    header = ui.context.client.request.headers.get('x-userinfo')
    if not header:
        return None

    try:
        return json.loads(base64.b64decode(header))
    except (binascii.Error, ValueError):
        return None
