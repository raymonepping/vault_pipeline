// App.jsx: the shell (vault_codex, vault_balancing). Frosted rail, floating
// topbar, the acts as hash routes, left and right arrows between them, ? for
// the shortcuts, and the "Vault said" drawer with the console's raw answers.
// An operator's button runs an act through the console workload; nothing
// here holds a token.
import { useCallback, useEffect, useState } from 'react';
import { Route, Workflow, BookOpenText, BadgeCheck, Archive, ScrollText, Layers3, ExternalLink, PanelLeftClose, PanelLeftOpen, Keyboard, Logs } from 'lucide-react';
import { useRoute, useResource } from './hooks.js';
import { useSaid } from './said.js';
import { Drawer, hms } from './components/ui.jsx';
import Footer from './components/Footer.jsx';
import Person from './components/Person.jsx';
import Line from './pages/Line.jsx';
import Pipe from './pages/Pipe.jsx';
import Librarian from './pages/Librarian.jsx';
import Badges from './pages/Badges.jsx';
import Backup from './pages/Backup.jsx';
import Custody from './pages/Custody.jsx';
import Layers from './pages/Layers.jsx';

export const PAGES = [
  { id: 'line', label: 'The Line', title: 'Prologue: The Line', icon: Route, Page: Line },
  { id: 'pipe', label: 'Into the Pipe', title: 'Act I: Into the Pipe', icon: Workflow, Page: Pipe },
  { id: 'librarian', label: 'The Librarian', title: 'Act II: The Librarian', icon: BookOpenText, Page: Librarian },
  { id: 'badges', label: 'The Badge Check', title: 'Act III: The Badge Check', icon: BadgeCheck, Page: Badges },
  { id: 'backup', label: 'The Lost Backup', title: 'Act IV: The Lost Backup', icon: Archive, Page: Backup },
  { id: 'custody', label: 'Custody', title: 'Epilogue: The Custody Log', icon: Logs, Page: Custody },
  { id: 'layers', label: 'Layers', title: 'How the house was built', icon: Layers3, Page: Layers },
];

function Brand() {
  return (
    <svg className="brand-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 2l12 7v14l-12 7-12-7V9z" fill="currentColor" />
      <path d="M9 17h14M16 10v14" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const FOLD_KEY = 'vpip.sidebar.collapsed';
const readFolded = () => {
  try {
    return window.localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
};
const writeFolded = (v) => {
  try {
    window.localStorage.setItem(FOLD_KEY, v ? '1' : '0');
  } catch {
    /* not remembered, still works */
  }
};

function NavLinks({ route, className, folded = false }) {
  return PAGES.map(({ id, label, icon: Icon }) => (
    <a key={id} href={`#/${id}`} className={`${className}${route === id ? ' active' : ''}`} aria-current={route === id ? 'page' : undefined} title={folded ? label : undefined}>
      <span className="nav-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="nav-label">{label}</span>
    </a>
  ));
}

function useKeys(route, onHelp) {
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('dialog[open], .vg-drawer'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const current = window.location.hash.replace(/^#\/?/, '').split('?')[0] || route;
      const i = Math.max(0, PAGES.findIndex((p) => p.id === current));
      if (e.key === 'ArrowRight' && i < PAGES.length - 1) window.location.hash = `#/${PAGES[i + 1].id}`;
      else if (e.key === 'ArrowLeft' && i > 0) window.location.hash = `#/${PAGES[i - 1].id}`;
      else if (e.key === '?') onHelp();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, onHelp]);
}

function VaultSaid() {
  const said = useSaid();
  if (!said.length) return <p className="muted">Nothing asked yet on this visit.</p>;
  return (
    <ol className="said-list">
      {said.map((e) => (
        <li key={`${e.at}-${e.label}`} className="said-item">
          <div className="said-head">
            <strong>{e.label}</strong>
            <span className="said-status ok">{hms(e.at)}</span>
          </div>
          <pre className="said-json">{JSON.stringify(e.data, null, 2)}</pre>
        </li>
      ))}
    </ol>
  );
}

export default function App() {
  const route = useRoute(PAGES.map((p) => p.id), 'line');
  const page = PAGES.find((p) => p.id === route);
  const me = useResource('/api/me');
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [folded, setFolded] = useState(readFolded);
  const onHelp = useCallback(() => setHelp(true), []);
  useKeys(route, onHelp);
  useEffect(() => {
    document.title = `${page.title}: Chain of Custody`;
  }, [page]);
  const toggleFold = () =>
    setFolded((f) => {
      writeFolded(!f);
      return !f;
    });

  return (
    <div className="vg-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`vg-sidebar${folded ? ' collapsed' : ''}`} aria-label="Pages">
        <div className="sidebar-brand">
          <Brand />
          <span className="brand-name">Chain of Custody</span>
        </div>
        <nav className="sidebar-nav" id="rail-nav">
          <NavLinks route={route} className="nav-item" folded={folded} />
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="sidebar-toggle" onClick={toggleFold} aria-expanded={!folded} aria-controls="rail-nav" title={folded ? 'Expand the sidebar' : 'Collapse the sidebar'}>
            {folded ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            <span className="sr-only">{folded ? 'Expand the sidebar' : 'Collapse the sidebar'}</span>
          </button>
          <p className="sidebar-note">Vault Enterprise 2.2, vault_pipeline</p>
        </div>
      </aside>

      <div className="vg-main">
        <div className="topbar-wrap">
          <header className="vg-topbar">
            <div className="topbar-left">
              <h1 className="page-title">{page.title}</h1>
            </div>
            <div className="topbar-right">
              <Person me={me.data} />
              <button type="button" className="vault-link said-button" onClick={() => setDrawer(true)}>
                <ScrollText aria-hidden="true" />
                <span className="link-label">Vault said</span>
              </button>
              <button type="button" className="vault-link said-button" onClick={onHelp} aria-label="Keyboard shortcuts">
                <Keyboard aria-hidden="true" />
              </button>
              <a className="vault-link" href="https://localhost:19301/ui/" target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                <span className="link-label">Vault UI</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </header>
          <nav className="mobile-nav" aria-label="Pages">
            <NavLinks route={route} className="mobile-nav__item" />
          </nav>
        </div>

        <main id="main" className="vg-content" tabIndex={-1}>
          {window.location.hash.includes('signin=failed') && (
            <p className="inline-notice error" role="alert">
              Sign-in did not complete. Try again; make doctor shows whether Keycloak answers.
            </p>
          )}
          <page.Page key={page.id} me={me.data} />
        </main>
        <Footer />
      </div>

      <Drawer open={drawer} title="Vault said" onClose={() => setDrawer(false)}>
        <p className="drawer-intro">The console's raw answers on this visit, newest first: what every word on these pages was built from. Vault's errors are verbatim; the console never returns a token.</p>
        <VaultSaid />
      </Drawer>

      <Drawer open={help} title="Keyboard" onClose={() => setHelp(false)}>
        <dl className="facts">
          <dt>
            <kbd>→</kbd>
          </dt>
          <dd>next page</dd>
          <dt>
            <kbd>←</kbd>
          </dt>
          <dd>previous page</dd>
          <dt>
            <kbd>?</kbd>
          </dt>
          <dd>this list</dd>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>close a drawer</dd>
        </dl>
      </Drawer>
    </div>
  );
}
