import './frame.css';

import { useRemote } from '@appshell/react';
import { getBasePath } from '@appshell/runtime';
import { getVars } from '@appshell/runtime/vars';
import { useEffect, useRef, useState } from 'react';

/** What this package declares in its appshell.config.yaml, as the application composed it. */
type FrameVars = {
  OWN_ORIGIN_SRC: string;
  SAME_ORIGIN_SRC: string;
  CROSS_SITE_SRC: string;
  SIZING: 'fill' | 'content';
  DATASET: string;
};

export const frameVars = () => getVars<FrameVars>();

/** What the container gave the slot this page is mounted in, beyond naming the remote. */
export type SlotProps = Record<string, unknown>;

/**
 * Props as they can cross to another document: JSON. A function or a React node has no meaning
 * on the other side, so it's left behind, and what the frame wants to say back is a message of
 * its own. As text, so two renders' props compare by value.
 */
const crossable = (props: SlotProps | undefined) => {
  try {
    return JSON.stringify(props ?? {});
  } catch {
    // Something circular. Nothing crosses, and the frame keeps what it last had.
    return '{}';
  }
};

/** Names the bridge and its version, so a frame ignores messages meant for something else. */
const PROTOCOL = 'appshell-frame/1';

type FromFrame =
  | { appshell: string; type: 'hello' }
  | { appshell: string; type: 'route'; route: string; title: string }
  | { appshell: string; type: 'size'; height: number };

/**
 * The application's theme, as the registry put it on the page.
 *
 * Found by what it looks like, because nothing hands it over: the composition carries no theme,
 * and @appshell/runtime has no accessor for one. It's forwarded as the stylesheet it is, so the
 * frame gets every --appshell-* property with its light and dark rules intact.
 */
const themeCss = () =>
  [...document.querySelectorAll('style')]
    .map((style) => style.textContent ?? '')
    .find((css) => css.trimStart().startsWith(':root') && css.includes('--appshell-')) ?? '';

/** light or dark where the application pins one, and system where each viewer's own applies. */
const colorScheme = () => document.documentElement.dataset.appshellTheme ?? 'system';

const theme = () => ({ themeCss: themeCss(), colorScheme: colorScheme() });

const address = () => window.location.pathname + window.location.search + window.location.hash;

/** The part of the page's address below where this page is mounted, or nothing once it has left. */
const routeUnder = (mount: string) => {
  const { pathname, search, hash } = window.location;
  if (pathname !== mount && !pathname.startsWith(`${mount}/`)) return undefined;

  return (pathname.slice(mount.length) || '/') + search + hash;
};

/**
 * A server-rendered app, framed, with the host's half of the bridge.
 *
 * The frame can't share the page's modules, so what a remote gets from the shared runtime
 * crosses by postMessage instead: the theme, the colour scheme and its vars go in, and its
 * route and its height come out. So do the props its container gave it: with `init`, and again
 * whenever they change, in a message of their own. The frame is never loaded again for them.
 *
 * It knows nothing of the layout's router, since a remote shares none with its container. It
 * reads and writes the page's address itself.
 */
export default function Frame({ src, props }: { src: string; props?: SlotProps }) {
  const remote = useRemote();
  const { SIZING: sizing, DATASET: dataset } = frameVars();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();

  const wire = crossable(props);
  /** The props to answer the frame's next hello with: it says one on every page it loads. */
  const latest = useRef(wire);
  /** Posts to the frame, from its first hello on. */
  const toFrame = useRef<(message: object) => void>(undefined);

  useEffect(() => {
    latest.current = wire;
    toFrame.current?.({ type: 'props', props: JSON.parse(wire) });
  }, [wire]);

  // Decided once, at mount. After that the frame navigates itself, and a new src would reload it.
  const [target] = useState(() => {
    const base = new URL(src, window.location.origin);
    const path = base.pathname.replace(/\/$/, '');
    const mount = `${getBasePath()}${String(remote?.metadata.route ?? '')}`;

    return {
      origin: base.origin,
      /** Where the app is served under, on its origin: nothing, or a prefix a proxy strips. */
      path,
      /** Where this page is mounted, in the application's address. */
      mount,
      /** A deep link opens the app at the route the page's address names. */
      initial: `${base.origin}${path}${routeUnder(mount) ?? '/'}`,
    };
  });

  useEffect(() => {
    const element = frame.current;
    if (!element) return undefined;

    /** The app's route as it last reported it. */
    let current: string | undefined;

    const post = (message: object) =>
      element.contentWindow?.postMessage({ appshell: PROTOCOL, ...message }, target.origin);

    const onMessage = (event: MessageEvent<FromFrame>) => {
      // Only this frame, and only while it's showing the origin it was pointed at.
      if (event.source !== element.contentWindow || event.origin !== target.origin) return;

      const message = event.data;
      if (message?.appshell !== PROTOCOL) return;

      if (message.type === 'hello') {
        toFrame.current = post;
        post({
          type: 'init',
          ...theme(),
          sizing,
          vars: { DATASET: dataset },
          props: JSON.parse(latest.current),
        });
      } else if (message.type === 'route') {
        current = message.route.startsWith(target.path)
          ? message.route.slice(target.path.length) || '/'
          : message.route;

        // The frame's own navigation already made the history entry, so the address is
        // corrected in place. The router's state is kept, or its next move would be lost.
        const mirrored = target.mount + (current === '/' ? '' : current);
        if (address() !== mirrored) window.history.replaceState(window.history.state, '', mirrored);
      } else if (message.type === 'size') {
        setHeight(message.height);
      }
    };

    /** The page's address moved under the frame: the layout's link to this page, or a traversal. */
    const onHostNavigation = () => {
      const wanted = routeUnder(target.mount);
      if (wanted === undefined || current === undefined || wanted === current) return;

      post({ type: 'navigate', url: target.path + wanted });
    };

    const schemeObserver = new MutationObserver(() => post({ type: 'theme', ...theme() }));
    schemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-appshell-theme'],
    });

    // pushState and replaceState fire no event of their own. The Navigation API reports them
    // where it exists, and popstate covers back and forward everywhere.
    const { navigation } = window as { navigation?: EventTarget };

    window.addEventListener('message', onMessage);
    window.addEventListener('popstate', onHostNavigation);
    navigation?.addEventListener('currententrychange', onHostNavigation);

    return () => {
      toFrame.current = undefined;
      schemeObserver.disconnect();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('popstate', onHostNavigation);
      navigation?.removeEventListener('currententrychange', onHostNavigation);
    };
  }, [target, sizing, dataset]);

  // fill: whatever is left of the viewport below where the layout put the frame.
  useEffect(() => {
    if (sizing !== 'fill') return undefined;

    const fill = () => {
      const top = frame.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(window.innerHeight - top - window.scrollY, 240));
    };

    fill();
    window.addEventListener('resize', fill);

    return () => window.removeEventListener('resize', fill);
  }, [sizing]);

  return (
    <iframe
      ref={frame}
      className="frame"
      title={String(remote?.metadata.displayName ?? 'Framed application')}
      src={target.initial}
      style={{ height }}
      // What NiceGUI needs to run. allow-same-origin gives the app its own origin back: without
      // it the frame is an opaque origin with no cookies or storage, and its websocket's origin
      // is null.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      allow="clipboard-write"
    />
  );
}
