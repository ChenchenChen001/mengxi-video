import {
  LEGACY_STREAM_1_ASSET_SPECS,
  LEGACY_STREAM_2_ASSET_SPECS,
  loadBuiltinImageObjects,
  resolveBuiltinAssetSources,
  type BuiltinImageObject,
  type BuiltinStreams,
} from './builtinAssetCatalog.ts';

const assetModules = import.meta.glob<string>(
  [
    './assets/mengxi/single/*.png',
    './assets/mengxi/double/*.png',
  ],
  {
    eager: true,
    import: 'default',
    query: '?inline',
  },
);

const stream1Sources = resolveBuiltinAssetSources(
  LEGACY_STREAM_1_ASSET_SPECS,
  assetModules,
);
const stream2Sources = resolveBuiltinAssetSources(
  LEGACY_STREAM_2_ASSET_SPECS,
  assetModules,
);

export const loadLegacyBuiltinStreams = async (): Promise<
  BuiltinStreams<BuiltinImageObject<HTMLImageElement>>
> => {
  const [stream1, stream2] = await Promise.all([
    loadBuiltinImageObjects(stream1Sources, () => new Image()),
    loadBuiltinImageObjects(stream2Sources, () => new Image()),
  ]);

  return { stream1, stream2 };
};
