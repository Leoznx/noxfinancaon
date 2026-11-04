import { validateFixtureOrigin } from "./demo-browser-fixture-origin.mjs";

// APIRequestContext can follow redirects outside Playwright page routing. Fetch
// exactly one response and reject redirects before giving it to the browser.
export async function serveFixtureResponse(route, fixtureOrigin, violations) {
  const origin = validateFixtureOrigin(fixtureOrigin);
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
    violations.push(`unapproved fixture request ${request.method()} ${url.href}`);
    return route.abort();
  }
  const response = await route.fetch({ maxRedirects: 0 });
  const headers = response.headers();
  if (
    (response.status() >= 300 && response.status() < 400) ||
    headers.location ||
    headers.refresh
  ) {
    violations.push(
      `blocked fixture redirect ${response.status()} ${url.pathname} -> ${headers.location || headers.refresh || "(no target)"}`,
    );
    await response.dispose();
    return route.abort();
  }
  // The browser context owns response cleanup. Disposing after fulfillment can
  // race the context teardown once the page has finished its assertions.
  await route.fulfill({ response });
}
