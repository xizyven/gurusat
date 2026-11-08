import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './components/Icon';
import { ConfirmHost, Logo, Spinner, ToastHost } from './components/ui';
import { Onboarding } from './components/Onboarding';
import { navigate, useRoute, useSettings } from './lib/store';
import { daysUntil } from './lib/util';
import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { Runner } from './runner/Runner';

const ImportPage = lazy(() => import('./pages/Import'));
const Editor = lazy(() => import('./pages/Editor'));
const Results = lazy(() => import('./pages/Results'));
const Review = lazy(() => import('./pages/Review'));
const Mistakes = lazy(() => import('./pages/Mistakes'));
const Scores = lazy(() => import('./pages/Scores'));
const SettingsPage = lazy(() => import('./pages/Settings'));

const NAV = [
  { path: '', label: 'Home', icon: 'home' },
  { path: 'tests', label: 'My Tests', icon: 'library' },
  { path: 'import', label: 'Add a Test', icon: 'upload' },
  { path: 'scores', label: 'Scores', icon: 'trend' },
  { path: 'mistakes', label: 'Mistake Notebook', icon: 'target' },
  { path: 'settings', label: 'Settings', icon: 'settings' },
];

export function App() {
  const route = useRoute();
  const [settings] = useSettings();
  const page = route[0] ?? '';

  // the runner takes over the whole screen, like Bluebook
  if (page === 'test' && route[1]) {
    return (
      <>
        <Runner key={route[1]} attemptId={route[1]} />
        <ConfirmHost />
        <ToastHost />
      </>
    );
  }
  if (page === 'review' && route[1]) {
    return (
      <Suspense fallback={<Spinner />}>
        <Review attemptId={route[1]} questionId={route[2]} />
        <ConfirmHost />
        <ToastHost />
      </Suspense>
    );
  }

  let content: ReactNode;
  switch (page) {
    case '':
      content = <Dashboard />;
      break;
    case 'tests':
      content = <Library />;
      break;
    case 'import':
      content = <ImportPage />;
      break;
    case 'edit':
      content = <Editor testId={route[1]} />;
      break;
    case 'results':
      content = <Results attemptId={route[1]} />;
      break;
    case 'mistakes':
      content = <Mistakes />;
      break;
    case 'scores':
      content = <Scores />;
      break;
    case 'settings':
      content = <SettingsPage />;
      break;
    default:
      content = (
        <div className="empty">
          <h3>Page not found</h3>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go home
          </button>
        </div>
      );
  }

  return (
    <Shell page={page}>
      <Suspense fallback={<Spinner />}>{content}</Suspense>
      {!settings.onboarded && <Onboarding />}
      <ConfirmHost />
      <ToastHost />
    </Shell>
  );
}

function Shell({ page, children }: { page: string; children: ReactNode }) {
  const [settings] = useSettings();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [page]);
  const days = daysUntil(settings.testDate);
  const activeNav = page === 'edit' ? 'tests' : page === 'results' ? 'scores' : page;
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <a className="side-logo" href="#/" aria-label="GuruSat home">
          <Logo height={30} />
        </a>
        <nav className="side-nav">
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={`side-link ${activeNav === n.path ? 'on' : ''}`}>
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="side-foot">
          {days !== null && days >= 0 && (
            <div className="side-countdown">
              <div className="side-count-num">{days}</div>
              <div className="side-count-label">
                {days === 1 ? 'day' : 'days'} until
                <br />
                test day
              </div>
            </div>
          )}
          <div className="side-private">
            <Icon name="shield" size={15} />
            Your tests stay in this browser
          </div>
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <div className="topbar">
          <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          <a href="#/" aria-label="GuruSat home">
            <Logo height={24} />
          </a>
          <span className="spacer" />
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
