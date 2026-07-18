type SerializedImage = string | {
  id?: unknown;
  src?: unknown;
};

type SerializedStream = {
  images?: SerializedImage[];
  [key: string]: unknown;
};

type SerializedConfig = {
  stream1?: SerializedStream;
  stream2?: SerializedStream;
  [key: string]: unknown;
};

export type SerializedProjectData = {
  imageRegistry?: Record<string, string>;
  paths?: SerializedConfig[];
  presets?: SerializedConfig[];
  version?: string;
  [key: string]: unknown;
};

export type HydratedProjectData<TImage> = {
  paths: Array<SerializedConfig & {
    hidden: boolean;
    s1Textures: unknown[];
    s2Textures: unknown[];
  }>;
  presets: SerializedConfig[];
};

const listStreams = (project: SerializedProjectData): SerializedStream[] => [
  ...(project.presets ?? []).flatMap(config => [
    config.stream1,
    config.stream2,
  ]),
  ...(project.paths ?? []).flatMap(config => [
    config.stream1,
    config.stream2,
  ]),
].filter((stream): stream is SerializedStream => Boolean(stream));

const collectImageSources = (
  project: SerializedProjectData,
): Record<string, string> => {
  const sources = { ...(project.imageRegistry ?? {}) };

  listStreams(project).forEach(stream => {
    (stream.images ?? []).forEach(image => {
      if (
        typeof image === 'object'
        && image !== null
        && typeof image.id === 'string'
        && typeof image.src === 'string'
      ) {
        sources[image.id] = image.src;
      }
    });
  });

  return sources;
};

const getImageId = (image: SerializedImage): string | null => {
  if (typeof image === 'string') return image;
  return typeof image.id === 'string' ? image.id : null;
};

export const hydrateProjectData = async <TImage>(
  project: SerializedProjectData,
  loadImage: (id: string, src: string) => Promise<TImage>,
): Promise<HydratedProjectData<TImage>> => {
  const imageSources = collectImageSources(project);
  const loadedEntries = await Promise.all(
    Object.entries(imageSources).map(async ([id, src]) => (
      [id, await loadImage(id, src)] as const
    )),
  );
  const imageRegistry = Object.fromEntries(loadedEntries) as Record<
    string,
    TImage
  >;

  const hydrateStream = (stream: SerializedStream = {}) => ({
    ...stream,
    images: (stream.images ?? [])
      .map(getImageId)
      .filter((id): id is string => Boolean(id))
      .map(id => imageRegistry[id])
      .filter((image): image is TImage => Boolean(image)),
  });

  const presets = (project.presets ?? []).map(preset => ({
    ...preset,
    stream1: hydrateStream(preset.stream1),
    stream2: hydrateStream(preset.stream2),
  }));
  const paths = (project.paths ?? []).map(path => ({
    ...path,
    hidden: typeof path.hidden === 'boolean' ? path.hidden : false,
    stream1: hydrateStream(path.stream1),
    stream2: hydrateStream(path.stream2),
    s1Textures: [],
    s2Textures: [],
  }));

  return { paths, presets };
};
