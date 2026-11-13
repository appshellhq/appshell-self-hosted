"""A research group's NiceGUI app: experiment runs, a chart driven from Python, a dialog."""

import math
import os

from nicegui import app, ui

import appshell_frame

appshell_frame.install(host_origins=os.environ.get('APPSHELL_HOST_ORIGINS', '').split())

RUNS = [
    {'id': 'r-104', 'model': 'resnet50', 'lr': 0.001, 'accuracy': 0.912},
    {'id': 'r-103', 'model': 'resnet50', 'lr': 0.01, 'accuracy': 0.874},
    {'id': 'r-102', 'model': 'vit-b16', 'lr': 0.0003, 'accuracy': 0.931},
    {'id': 'r-101', 'model': 'vit-b16', 'lr': 0.003, 'accuracy': 0.902},
]


def curve(lr: float) -> list[list[float]]:
    return [[epoch, round(1 - math.exp(-epoch * lr * 40) * 0.9, 3)] for epoch in range(0, 31)]


@ui.page('/')
def index():
    # A session cookie's worth of state: does the browser send this app its cookie in a frame?
    visits = app.storage.user['visits'] = app.storage.user.get('visits', 0) + 1

    with ui.column().classes('w-full p-6 gap-4'):
        ui.label('Experiment runs').classes('text-h5')
        from_host = ui.label('Not framed by a host.').classes('text-caption').mark('from-host')
        appshell_frame.on_host(
            lambda host: from_host.set_text(
                f'Dataset {host.vars.get("DATASET")}, from the host. Colour scheme: {host.color_scheme}.'
            )
        )
        ui.label(f'Visits this session: {visits}').classes('text-caption').mark('visits')

        with ui.card().classes('w-full'):
            with ui.row().classes('items-center gap-4'):
                ui.label('Learning rate')
                slider = ui.slider(min=0.0005, max=0.01, step=0.0005, value=0.003).classes('w-64')
                ui.label().bind_text_from(slider, 'value', lambda v: f'{v:.4f}')
            chart = ui.echart({
                'xAxis': {'type': 'value', 'name': 'epoch'},
                'yAxis': {'type': 'value', 'name': 'accuracy', 'max': 1},
                'series': [{'type': 'line', 'showSymbol': False, 'data': curve(0.003)}],
            }).classes('w-full h-64')

            def redraw(e):
                chart.options['series'][0]['data'] = curve(e.value)
                chart.update()

            slider.on_value_change(redraw)

        with ui.card().classes('w-full'):
            for run in RUNS:
                with ui.row().classes('items-center gap-6'):
                    ui.link(run['id'], f'/runs/{run["id"]}').mark(f'run-{run["id"]}')
                    ui.label(run['model'])
                    ui.label(f'{run["accuracy"]:.1%}')

        with ui.dialog() as dialog, ui.card():
            ui.label('Archive this experiment?').classes('text-h6')
            ui.label('Its runs stay readable, and no new ones can be added.')
            with ui.row():
                ui.button('Archive', on_click=dialog.close)
                ui.button('Cancel', on_click=dialog.close).props('flat')

        with ui.row():
            ui.button('Archive…', on_click=dialog.open).mark('open-dialog')
            ui.button('Notify', on_click=lambda: ui.notify('Saved', type='positive')).props('outline')
            ui.select(['resnet50', 'vit-b16', 'convnext'], value='resnet50', label='Model').classes('w-40')

        long = ui.switch('Show every epoch').mark('long')
        with ui.column().bind_visibility_from(long, 'value'):
            for epoch, accuracy in curve(0.003):
                ui.label(f'epoch {epoch:.0f}: {accuracy}')


@ui.page('/runs/{run_id}')
def run(run_id: str):
    found = next((r for r in RUNS if r['id'] == run_id), None)

    with ui.column().classes('w-full p-6 gap-4'):
        ui.link('← All runs', '/').mark('back')
        if not found:
            ui.label(f'No run {run_id}.').classes('text-h5')
            return

        ui.label(f'Run {found["id"]}').classes('text-h5').mark('run-title')
        ui.label(f'{found["model"]}, learning rate {found["lr"]}, accuracy {found["accuracy"]:.1%}')
        ui.echart({
            'xAxis': {'type': 'value', 'name': 'epoch'},
            'yAxis': {'type': 'value', 'name': 'accuracy', 'max': 1},
            'series': [{'type': 'line', 'showSymbol': False, 'data': curve(found['lr'])}],
        }).classes('w-full h-64')


ui.run(
    host='0.0.0.0',
    port=8080,
    title='Research',
    reload=False,
    show=False,
    # Fine on your machine. The cookie it signs is the one the cross-site page tests.
    storage_secret=os.environ.get('STORAGE_SECRET', 'spike-only-storage-secret'),
)
