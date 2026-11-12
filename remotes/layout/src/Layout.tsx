import './layout.css';

import { RemoteSlot } from '@appshell/react';
import { getBasePath, getRemotes } from '@appshell/runtime';
import { useMemo } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router';

/** The metadata keys this layout reads, as a package publishes them in its appshell.config.yaml. */
type PageMetadata = {
  route?: unknown;
  displayName?: unknown;
  order?: unknown;
};

type Page = {
  /** The remote's key, `scope/package/Component`, as `RemoteSlot` mounts it. */
  remote: string;
  route: string;
  name: string;
  order: number;
};

/**
 * The application's root, or plain path segments under it, so a route can't point elsewhere:
 * `//host` would be another site.
 */
const ROUTE = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;

/**
 * The pages the application's packages contribute: every component that publishes a route, in
 * the order they publish. Appshell itself reads none of this metadata. It's this layout's own
 * contract with the packages it mounts.
 */
const pagesOf = (remotes: Record<string, { metadata?: PageMetadata }>): Page[] =>
  Object.entries(remotes)
    .flatMap(([remote, { metadata }]): Page[] => {
      const route = metadata?.route;
      if (typeof route !== 'string' || !ROUTE.test(route)) return [];

      return [
        {
          remote,
          route,
          name: typeof metadata?.displayName === 'string' ? metadata.displayName : remote,
          order: typeof metadata?.order === 'number' ? metadata.order : Number.POSITIVE_INFINITY,
        },
      ];
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

/**
 * The frame the application mounts at its root: a header, navigation down the side, and each
 * page at its route.
 *
 * Everything comes from the composition the registry put on the page, so a package activated in
 * the application, or one an overlay brings in from a dev server, shows up here with nothing
 * changed in this package.
 */
export default function Layout() {
  const pages = useMemo(() => pagesOf(getRemotes<PageMetadata>()), []);
  const start = pages[0]?.route;

  return (
    <BrowserRouter basename={getBasePath()}>
      <div className="layout">
        <header className="layout-header">{document.title}</header>
        <nav className="layout-nav" aria-label="Pages">
          {pages.map(({ remote, route, name }) => (
            <NavLink key={remote} to={route} end={route === '/'}>
              {name}
            </NavLink>
          ))}
        </nav>
        <main className="layout-main">
          <Routes>
            {pages.map(({ remote, route }) => (
              <Route
                key={remote}
                path={route === '/' ? '/*' : `${route}/*`}
                element={<RemoteSlot key={remote} remote={remote} />}
              />
            ))}
            {start && start !== '/' && <Route index element={<Navigate to={start} replace />} />}
            <Route path="*" element={<p>Nothing is mounted here.</p>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
