// Fail before launching Chromium or making a request. Never accept a remote origin.
export function validateFixtureOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "NOX_TEST_ORIGIN must be an HTTP loopback fixture origin with an explicit port, no credentials, path, query or fragment.",
    );
  }
  // Avoid DNS resolution even when callers use the conventional localhost name.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}
