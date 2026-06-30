const DESKTOP_FALLBACK_ORIGIN = 'asm-agent://local';

export function resolveRendererFallbackEndpoint(
  endpointPath: string,
  locationLike: Pick<Location, 'protocol'> | undefined = typeof window !== 'undefined' ? window.location : undefined
): string {
  if (locationLike?.protocol === 'file:') {
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    return `${DESKTOP_FALLBACK_ORIGIN}${normalizedPath}`;
  }

  return endpointPath;
}
