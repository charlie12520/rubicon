export function latestVersionUrl(currentHref: string, refreshToken = Date.now()): string {
  const url = new URL(currentHref);
  url.searchParams.set("appRefresh", String(refreshToken));
  return url.toString();
}

export function refreshToLatestVersion(): void {
  window.location.replace(latestVersionUrl(window.location.href));
}
