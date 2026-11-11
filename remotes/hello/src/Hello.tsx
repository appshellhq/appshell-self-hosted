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
      <h1>Hello from your machine</h1>
      <p>
        Your dev server is serving this page into your copy of the portal, for your browser only.
        Anyone else who opens the application sees it without this page.
      </p>
      <p>
        Edit <code>remotes/hello/src/Hello.tsx</code> and save: this page updates in place.
      </p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
    </section>
  );
}
