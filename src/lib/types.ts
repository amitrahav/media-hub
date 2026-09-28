export type MediaType = 'movie' | 'series';

// ---- Stremio addon protocol (https://github.com/Stremio/stremio-addon-sdk/tree/master/docs) ----

export interface ManifestCatalog {
  type: string;
  id: string;
  name?: string;
  extra?: { name: string; isRequired?: boolean; options?: string[] }[];
  extraRequired?: string[];
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  logo?: string;
  types: string[];
  catalogs: ManifestCatalog[];
  resources: (string | { name: string; types?: string[]; idPrefixes?: string[] })[];
  idPrefixes?: string[];
}

export interface Addon {
  transportUrl: string;
  manifest: Manifest;
}

export interface Video {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
  description?: string;
}

export interface MetaPreview {
  id: string;
  type: MediaType | string;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
}

export interface Meta extends MetaPreview {
  videos?: Video[];
  runtime?: string;
  cast?: string[];
  director?: string[];
  trailers?: { source: string; type: string }[];
  imdb_id?: string;
  moviedb_id?: number;
}

export interface Stream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    filename?: string;
    videoSize?: number;
    proxyHeaders?: unknown;
  };
}

export interface SourcedStream extends Stream {
  addonName: string;
  addonUrl: string;
}
