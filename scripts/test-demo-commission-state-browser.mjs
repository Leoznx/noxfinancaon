// Component integration test: real React UI + identity hook, mocked Auth/profile boundary.
// No production server, user or provider is contacted.
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
const mobile = process.env.NOX_DEMO_SURFACE === "mobile";
const root = mobile ? path.resolve("../noxfinancaonmobile") : process.cwd();

const stubs = {
  "@/components/AuthProvider": `export function useAuth(){return {user:window.testUser,isLoading:false}}`,
  "@/components/DashboardLayout": `export function DashboardLayout({children}){return children}`,
  "@/components/ui/button": `import React from 'react'; export function Button({variant,...props}){return <button {...props}/>}`,
  "@/integrations/supabase/client": `export const supabase={auth:{getUser:async()=>{window.identityReads++;return {data:{user:window.verifiedUser},error:null}}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>{window.profileReads++;return {data:{role:window.verifiedUser?.role},error:null}}})})})};`,
};
stubs["@/providers/auth-provider"] =
  `export function useAuth(){return {user:window.testUser,loading:false}}`;
stubs["@/components/screen-container"] =
  `export function ScreenContainer({children}){return children}`;
stubs["@/lib/supabase"] = stubs["@/integrations/supabase/client"];
// Native primitives are adapted to DOM for interaction tests; this is not a device test.
stubs["react-native"] =
  `import React from 'react';export const StyleSheet={create:x=>x};export function Text({children}){return <div>{children}</div>} export const View=Text;export const ScrollView=Text;export function Pressable({children,onPress}){return <button onClick={onPress}>{children}</button>}`;
stubs["expo-router"] =
  `import React from 'react';export function useFocusEffect(callback){React.useEffect(()=>{const cleanup=callback();const blur=()=>cleanup?.();window.addEventListener('demo-test-blur',blur);return ()=>{window.removeEventListener('demo-test-blur',blur);cleanup?.();}},[callback]);}`;
stubs["@/components/ui/dialog"] =
  `import React from 'react';const C=React.createContext(false);export function Dialog({open,children}){return <C.Provider value={open}>{children}</C.Provider>}export function DialogContent({children}){return React.useContext(C)?<div>{children}</div>:null}export const DialogHeader=({children})=><div>{children}</div>;export const DialogTitle=DialogHeader;`;
stubs["react-native"] =
  `import React from 'react';export const StyleSheet={create:x=>x};export const Text=({children})=><div>{children}</div>;export const View=Text;export const ScrollView=Text;export const Modal=({visible,children})=>visible?<div>{children}</div>:null;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;`;
const component = path.join(
  root,
  mobile
    ? "src/components/demo-commission-boundary.tsx"
    : "src/components/DemoCommissionBoundary.tsx",
);
const bundle = await build({
  alias: { react: path.resolve("node_modules/react") },
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {DemoCommissionBoundary} from ${JSON.stringify(component)}; function Operational(){window.operationalMounts++;return <div>Operational account</div>} const root=createRoot(document.getElementById('root'));window.renderTest=()=>root.render(<DemoCommissionBoundary><Operational/></DemoCommissionBoundary>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  plugins: [
    {
      name: "test-adapters",
      setup(b) {
        b.onResolve({ filter: /^@\/|^react-native$|^expo-router$/ }, (args) => {
          if (stubs[args.path]) return { path: args.path, namespace: "stub" };
          const file = path.join(root, "src", args.path.slice(2));
          return { path: [".ts", ".tsx"].map((ext) => file + ext).find(existsSync) };
        });
        b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(
    req.url === "/bundle.js"
      ? bundle.outputFiles[0].text
      : '<div id="root"></div><script src="/bundle.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const external = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.startsWith(origin + "/")) {
      external.push(url);
      return route.abort();
    }
    return route.fulfill({
      status: 200,
      contentType: url.endsWith("bundle.js") ? "text/javascript" : "text/html",
      body: url.endsWith("bundle.js")
        ? bundle.outputFiles[0].text
        : '<div id="root"></div><script src="/bundle.js"></script>',
    });
  });
  await page.goto(origin);
  async function identity(email, id = "one", role = "corretor") {
    await page.evaluate(
      ({ email, id, role }) => {
        window.identityReads = 0;
        window.profileReads = 0;
        window.operationalMounts = 0;
        window.testUser = { email, id, role };
        window.verifiedUser = window.testUser;
        window.renderTest();
      },
      { email, id, role },
    );
  }
  async function withdraw() {
    await page.getByRole("button", { name: "Sacar (simulação)", exact: true }).click();
    if (mobile) {
      for (const label of ["Chave Pix fictícia", "Titular fictício", "Banco fictício"])
        await page.getByRole("button", { name: label, exact: true }).click();
    } else {
      for (const select of await page.locator("select").all())
        await select.selectOption({ index: 1 });
    }
    await page.getByRole("button", { name: "Confirmar saque fictício", exact: true }).click();
    await page.getByText(/DEMO-SQ-2026-001/).waitFor();
  }
  await identity("corretor@nox.com");
  await withdraw();
  await identity("real@example.invalid");
  await page.getByText("Operational account").waitFor();
  assert.equal(await page.getByText(/DEMO-SQ-2026-001/).count(), 0);
  await identity("corretor@nox.com");
  await page.getByText("Comissões demonstrativas", { exact: true }).waitFor();
  assert.equal(await page.getByText(/DEMO-SQ-2026-001/).count(), 0);
  await withdraw();
  await identity("imobiliaria@nox.com", "two", "imobiliaria");
  await page.getByText("Comissões demonstrativas", { exact: true }).waitFor();
  assert.equal(await page.getByText(/DEMO-SQ-2026-001/).count(), 0);
  if (mobile) {
    await withdraw();
    await page.evaluate(() => window.dispatchEvent(new Event("demo-test-blur")));
    await page.getByText(/DEMO-SQ-2026-001/).waitFor({ state: "hidden" });
    assert.equal(await page.getByText(/DEMO-SQ-2026-001/).count(), 0);
  }
  assert.deepEqual(external, []);
  console.log(
    `PASS ${mobile ? "mobile" : "web"} commission identity reset and native blur (DOM adapters)`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
