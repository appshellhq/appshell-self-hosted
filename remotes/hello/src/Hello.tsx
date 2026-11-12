import './hello.css';

import { useState } from 'react';

/**
 * A page in the portal. The layout mounts it at the route appshell.config.yaml gives, and lists
 * it in its navigation: nothing here knows about either. Edit it and save while its dev server
 * runs, and the page updates in place, keeping the count.
 */
export default function Hello() {
  const [count, setCount] = useState(0);

  return (
    <section className="hello">
      <h1>Hello</h1>
      <p>
        This is the page you develop. While its dev server runs and an overlay points your
        browser at it, your copy of the portal runs it from your machine, for your browser only.
        Once you publish it and activate it, everyone who opens the application sees it.
      </p>
      <p>
        Edit <code>remotes/hello/src/Hello.tsx</code> and save while the dev server runs: this
        page updates in place.
      </p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
    </section>
  );
}
