/*
 * The frame's half of the bridge to an appshell host. Runs in the page's head, before NiceGUI's
 * own client, on every page of the app.
 *
 * __HOSTS__ is replaced with the origins allowed to host this app.
 */
(() => {
  // Opened on its own rather than framed: nothing to talk to, and the app runs as it always did.
  if (window.parent === window) return;

  const PROTOCOL = 'appshell-frame/1';
  const HOSTS = __HOSTS__;

  /** The origin that answered, once one has. Everything after hello goes to it alone. */
  let host;
  /** What init carried, kept for Python, which connects later than this runs. */
  let init;
  /** What the container gave this app's slot, as last heard. */
  let props = {};
  /** Whether Python has init, and so hears each change after it. */
  let delivered = false;

  // For a page's own script, whatever framework drew it. Python is told below.
  window.appshellFrame = {
    get props() {
      return props;
    },
  };

  const post = (type, body, to) =>
    window.parent.postMessage({ appshell: PROTOCOL, type, ...body }, to);

  const route = () => window.location.pathname + window.location.search + window.location.hash;
  const reportRoute = () => host && post('route', { route: route(), title: document.title }, host);

  // Unthemed content would flash before the host answers, so nothing paints until it has. A
  // host that never answers still gets a page, a moment later.
  const root = document.documentElement;
  root.classList.add('appshell-pending');
  const reveal = () => root.classList.remove('appshell-pending');
  setTimeout(reveal, 1500);

  const applyScheme = (colorScheme) => {
    // Quasar's dark mode is a class it puts on the body, so the body has to exist.
    if (!window.Quasar || !document.body) return false;
    window.Quasar.Dark.set(colorScheme === 'system' ? 'auto' : colorScheme === 'dark');
    return true;
  };

  const applyTheme = ({ themeCss, colorScheme }) => {
    let style = document.getElementById('appshell-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'appshell-theme';
      // First in the head, so the app's own CSS can still override a token.
      document.head.prepend(style);
    }
    style.textContent = themeCss;

    if (colorScheme === 'system') delete root.dataset.appshellTheme;
    else root.dataset.appshellTheme = colorScheme;

    // NiceGUI sets Quasar's dark mode itself when it starts, after this has run, so it's
    // applied again once the page has loaded.
    if (!applyScheme(colorScheme)) {
      window.addEventListener('load', () => applyScheme(colorScheme), { once: true });
    }
  };

  /** Hands init to Python once NiceGUI's socket is up: emitEvent needs its app mounted. */
  const deliver = () => {
    if (typeof window.emitEvent !== 'function' || !window.socket?.connected) {
      setTimeout(deliver, 50);
      return;
    }
    // The props as they are now: they may have changed while the socket was connecting.
    window.emitEvent('appshell_init', { vars: init.vars, colorScheme: init.colorScheme, props });
    delivered = true;
  };

  /** New props: whole, replacing the last, so a missed message costs nothing once the next lands. */
  const setProps = (next) => {
    props = next && typeof next === 'object' ? next : {};
    window.dispatchEvent(new CustomEvent('appshell:props', { detail: props }));
    if (delivered) window.emitEvent('appshell_props', { props });
  };

  const reportSize = () => {
    let last;
    const measure = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height !== last) post('size', { height: (last = height) }, host);
    };
    new ResizeObserver(measure).observe(document.documentElement);
    window.addEventListener('load', measure);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !HOSTS.includes(event.origin)) return;

    const message = event.data;
    if (!message || message.appshell !== PROTOCOL) return;

    if (message.type === 'init') {
      host = event.origin;
      init = message;
      setProps(message.props);
      applyTheme(message);
      reveal();
      reportRoute();
      if (message.sizing === 'content') reportSize();
      deliver();
    } else if (message.type === 'theme') {
      applyTheme(message);
    } else if (message.type === 'props') {
      // Before init there's nobody to tell, and init carries them anyway.
      if (host) setProps(message.props);
    } else if (message.type === 'navigate') {
      // replace: the host's own navigation already made the history entry.
      if (message.url !== route()) window.location.replace(message.url);
    }
  });

  // A page that changes its address without loading again (ui.sub_pages) still reports it.
  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method];
    window.history[method] = function patched(...args) {
      const result = original.apply(this, args);
      reportRoute();
      return result;
    };
  }
  window.addEventListener('popstate', reportRoute);

  // To anyone, as it has to be before the host is known, and so it says nothing. Only an
  // allowed origin can frame this app at all (frame-ancestors), and only its answer is heard.
  post('hello', {}, '*');
})();
