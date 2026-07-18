export type BuiltinAssetCategory = 'single' | 'double';

export type BuiltinAssetSpec = {
  id: string;
  label: string;
  filename: string;
  category: BuiltinAssetCategory;
};

export type BuiltinAssetSource = BuiltinAssetSpec & {
  src: string;
};

export type BuiltinImageObject<T> = {
  id: string;
  img: T;
};

export type BuiltinStreams<T> = {
  stream1: T[];
  stream2: T[];
};

const singleAsset = (label: string): BuiltinAssetSpec => ({
  id: `builtin:legacy:stream-1:${label}`,
  label,
  filename: `${label}.png`,
  category: 'single',
});

const doubleAsset = (label: string): BuiltinAssetSpec => ({
  id: `builtin:legacy:stream-2:${label}`,
  label,
  filename: `${label}.png`,
  category: 'double',
});

export const LEGACY_STREAM_1_ASSET_SPECS = [
  '造',
  '经',
  '木',
  '云',
  '法',
].map(singleAsset);

export const LEGACY_STREAM_2_ASSET_SPECS = [
  '象形',
  '版本',
  '活版',
  '畢昇',
  '算术',
  '典籍',
  '版印',
  '星辰',
  '六善',
  '形察',
  '造微',
].map(doubleAsset);

export const resolveBuiltinAssetSources = (
  specs: BuiltinAssetSpec[],
  modules: Record<string, string>,
): BuiltinAssetSource[] => specs.map(spec => {
  const modulePath = `./assets/mengxi/${spec.category}/${spec.filename}`;
  const src = modules[modulePath];

  if (!src) {
    throw new Error(`Missing bundled asset module: ${modulePath}`);
  }

  return { ...spec, src };
});

export const loadBuiltinImageObjects = async <T>(
  assets: BuiltinAssetSource[],
  createImage: () => T,
): Promise<BuiltinImageObject<T>[]> => Promise.all(assets.map(asset => (
  new Promise<BuiltinImageObject<T>>((resolve, reject) => {
    const img = createImage() as T & {
      onerror: (() => void) | null;
      onload: (() => void) | null;
      src: string;
    };

    img.onload = () => resolve({ id: asset.id, img });
    img.onerror = () => reject(
      new Error(`Failed to load builtin asset: ${asset.label}`),
    );
    img.src = asset.src;
  })
)));

export const initializeEmptyBuiltinStreams = <
  TImage,
  TStream extends { images: TImage[] },
  TConfig extends { stream1: TStream; stream2: TStream },
>(
  config: TConfig,
  builtinStreams: BuiltinStreams<TImage>,
): TConfig => ({
  ...config,
  stream1: config.stream1.images.length > 0
    ? config.stream1
    : { ...config.stream1, images: [...builtinStreams.stream1] },
  stream2: config.stream2.images.length > 0
    ? config.stream2
    : { ...config.stream2, images: [...builtinStreams.stream2] },
}) as TConfig;
