import './home.css';

import { getRemotes } from '@appshell/runtime';
import { useMemo } from 'react';

/** A published version's address, as the registry serves it: /p/<scope>/<name>/<version>/. */
const PUBLISHED = /\/p\/([^/]+)\/([^/]+)\/([^/]+)\/[^/]+$/;

/**
 * Where a component's code comes from: a published version, which the registry serves from the
 * bundles server, or a dev server an overlay points this browser at.
 */
const sourceOf = (remoteEntryUrl: string) => {
  const url = new URL(remoteEntryUrl, window.location.href);
  const published = url.pathname.match(PUBLISHED);

  return published
    ? `${published[1]}/${published[2]}@${published[3]}`
    : `${url.origin}, through an overlay`;
};

/**
 * The application's start page. It lists what this page is composed of, read from the
 * composition the registry put on it, so activating a version, rolling one back or opening an
 * overlay shows here on the next load.
 */
export default function Home() {
  const components = useMemo(
    () =>
      Object.entries(getRemotes())
        .map(([key, { remoteEntryUrl }]) => ({ key, source: sourceOf(remoteEntryUrl) }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    [],
  );

  return (
    <section className="home">
      <h1>Your registry composed this page</h1>
      <p>
        Each part of it is a package, published once and activated in this application. The
        registry serves their code from the bundles server, at
        <code> /p/&lt;scope&gt;/&lt;name&gt;/&lt;version&gt;/</code> on this page&apos;s own
        origin.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Code from</th>
          </tr>
        </thead>
        <tbody>
          {components.map(({ key, source }) => (
            <tr key={key}>
              <td>
                <code>{key}</code>
              </td>
              <td>
                <code>{source}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
