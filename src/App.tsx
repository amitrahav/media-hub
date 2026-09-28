import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { focusInitial, installSpatialNav, watchFocus } from './lib/spatialNav';
import { IntroSting } from './components/IntroSting';
import { useApp } from './state/AppState';
import { Home } from './pages/Home';
import { Details } from './pages/Details';
import { PersonPage } from './pages/Person';
import { Watch } from './pages/Watch';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';

export function App() {
  const { settings } = useApp();
  const location = useLocation();
  const [intro, setIntro] = useState(() => settings.introSting && !sessionStorage.getItem('mh:intro'));
  const inPlayer = location.pathname.startsWith('/watch');

  useEffect(() => window.scrollTo(0, 0), [location.pathname]);

  // TV remote / D-pad navigation.
  const navigate = useNavigate();
  const atHome = location.pathname === '/';
  useEffect(() => {
    if (!settings.tvMode) return;
    const off = installSpatialNav(() => !atHome && navigate(-1));
    const unwatch = watchFocus();
    return () => {
      off();
      unwatch();
    };
  }, [settings.tvMode, navigate, atHome]);
  useEffect(() => {
    if (!settings.tvMode) return;
    (document.activeElement as HTMLElement | null)?.blur();
    const t = setTimeout(focusInitial, 400);
    return () => clearTimeout(t);
  }, [settings.tvMode, location.pathname]);

  const endIntro = () => {
    sessionStorage.setItem('mh:intro', '1');
    setIntro(false);
  };

  return (
    <>
      {intro && <IntroSting onDone={endIntro} />}
      {!inPlayer && <Nav />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/movies" element={<Home type="movie" />} />
        <Route path="/series" element={<Home type="series" />} />
        <Route path="/title/:type/:id" element={<Details />} />
        <Route path="/person/:id" element={<PersonPage />} />
        <Route path="/watch/:type/:id/:videoId" element={<Watch />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </>
  );
}

function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`nav ${solid ? 'nav--solid' : ''}`}>
      <NavLink to="/" className="nav__brand">MEDIA HUB</NavLink>
      <div className="nav__links">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/movies">Movies</NavLink>
        <NavLink to="/series">Series</NavLink>
      </div>
      <span className="spacer" />
      <NavLink to="/search" className="nav__icon" aria-label="Search">⌕</NavLink>
      <NavLink to="/settings" className="nav__icon" aria-label="Settings">⚙︎</NavLink>
    </nav>
  );
}
