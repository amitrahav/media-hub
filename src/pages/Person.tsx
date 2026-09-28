import { Link, useParams } from 'react-router-dom';
import { Row } from '../components/Row';
import { img, person, stremioType, titleOf, yearOf } from '../lib/tmdb';
import { fromTmdb } from '../lib/tiles';
import { useAsync } from '../lib/useAsync';

/** "Where have I seen them before?" — actor page with Known For + full filmography. */
export function PersonPage() {
  const { id = '' } = useParams();
  const { data, loading } = useAsync(() => person(Number(id)), [id]);
  if (loading) return <main className="page page--center"><div className="spinner" /></main>;
  if (!data) return <main className="page page--center">Person not found.</main>;
  const { person: p, knownFor, filmography } = data;

  return (
    <main className="page page--person">
      <header className="person">
        {p.profile_path && <img className="person__photo" src={img(p.profile_path, 'h632')} alt={p.name} />}
        <div>
          <h1>{p.name}</h1>
          <div className="meta-line">
            <span className="badge">{p.known_for_department}</span>
            {p.birthday && <span>Born {p.birthday}{p.place_of_birth ? ` · ${p.place_of_birth}` : ''}</span>}
          </div>
          <p className="person__bio">{p.biography || 'No biography available.'}</p>
        </div>
      </header>
      <Row title="Known For" tiles={knownFor.map(fromTmdb)} />
      <section className="filmography">
        <h2 className="row__title">Filmography</h2>
        <ul>
          {filmography.map((c) => (
            <li key={`${c.media_type}${c.id}`}>
              <span className="filmography__year">{yearOf(c) || '—'}</span>
              <Link to={`/title/${stremioType(c.media_type ?? 'movie')}/tmdb:${c.id}`}>{titleOf(c)}</Link>
              <span className="filmography__role">
                {c.character ? `as ${c.character}` : ''}
                {c.media_type === 'tv' && c.episode_count ? ` · ${c.episode_count} ep` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
