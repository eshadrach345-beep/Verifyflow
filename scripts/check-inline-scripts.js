const fs = require("node:fs");
const vm = require("node:vm");

const htmlFiles = ["index.html", "dashboard.html", "account.html"];
let checked = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  for (let index = 0; index < scripts.length; index += 1) {
    const source = scripts[index][1].trim();
    if (!source) continue;
    new vm.Script(source, { filename: file + "#inline-script-" + (index + 1) });
    checked += 1;
  }
}

console.log("Checked " + checked + " inline browser scripts across " + htmlFiles.length + " pages.");
