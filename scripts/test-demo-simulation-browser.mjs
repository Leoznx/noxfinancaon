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

for (const file of mobile
  ? [
      "src/app/apolices.tsx",
      "src/app/faturas-inquilinos.tsx",
      "src/app/inquilino/faturas.tsx",
      "src/app/simular.tsx",
    ]
  : [
      "src/routes/apolices.index.tsx",
      "src/routes/faturas-inquilinos.index.tsx",
      "src/routes/inquilino.faturas.tsx",
      "src/routes/consultas.nova.tsx",
    ]) {
  assert.match(
    readFileSync(path.join(root, file), "utf8"),
    /<DemoSimulationBoundary>[^]*?<\/DemoSimulationBoundary>/,
  );
}
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
const component = path.join(
  root,
  mobile
    ? "src/components/demo-simulation-boundary.tsx"
    : "src/components/DemoSimulationBoundary.tsx",
);
const bundle = await build({
  alias: { react: path.resolve("node_modules/react") },
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {DemoSimulationBoundary} from ${JSON.stringify(component)}; function Operational(){window.operationalMounts++;return <div>Operational account</div>} window.renderTest=()=>createRoot(document.getElementById('root')).render(<DemoSimulationBoundary><Operational/></DemoSimulationBoundary>);`,
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
  for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino", "real", "denied"]) {
    const page = await browser.newPage();
    let external = 0;
    await page.route("**/*", (route) => {
      if (
        !route
          .request()
          .url()
          .startsWith(origin + "/")
      ) {
        external++;
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin);
    await page.evaluate((role) => {
      window.identityReads = 0;
      window.profileReads = 0;
      window.operationalMounts = 0;
      window.testUser = {
        id: "test-id",
        role: role === "real" || role === "denied" ? "corretor" : role,
        email:
          role === "real" ? "real@example.com" : `${role === "denied" ? "corretor" : role}@nox.com`,
      };
      window.verifiedUser = role === "denied" ? null : window.testUser;
      sessionStorage.setItem("nox_demo_session", "corretor");
      window.renderTest();
    }, role);
    if (role === "real") {
      await page.getByText("Operational account").waitFor();
      assert.equal(await page.evaluate(() => window.identityReads), 0);
    } else if (role === "denied") {
      await page.getByText(/Não foi possível verificar/).waitFor();
      assert.equal(await page.evaluate(() => window.operationalMounts), 0);
      assert.equal(await page.getByRole("button").count(), 0);
    } else {
      await page.getByText("Simulação completa", { exact: true }).waitFor();
      for (const name of [
        "Simular análise",
        "Simular conferência",
        "Simular ativação sem assinatura",
        "Simular pagamento",
      ])
        await page.getByRole("button", { name, exact: true }).click();
      await page.getByText("Recibo demonstrativo", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.operationalMounts), 0);
      assert.equal(await page.evaluate(() => window.identityReads), 1);
      assert.equal(await page.evaluate(() => window.profileReads), 1);
      if (mobile) {
        await page.evaluate(() => window.dispatchEvent(new Event("demo-test-blur")));
        await page.getByText("Análise de crédito", { exact: true }).waitFor();
      }
      await page.getByRole("button", { name: "Reiniciar simulação" }).click();
      await page.getByText("Análise de crédito", { exact: true }).waitFor();
      for (const name of ["Recusado", "Em análise"]) {
        await page.getByRole("button", { name, exact: true }).click();
        await page.getByRole("button", { name: "Simular análise", exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "Simular pagamento" }).count(), 0);
      }
    }
    assert.equal(external, 0);
    console.log(`PASS ${mobile ? "mobile" : "web"} ${role}: isolated component flow`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
