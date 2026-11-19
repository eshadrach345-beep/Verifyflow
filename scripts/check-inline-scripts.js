const fs = require("node:fs");
const vm = require("node:vm");

const htmlFiles = [
  "index.html",
  "dashboard.html",\n  "admin.html",
  "account.html",
  "payment-test.html",
  "payment-return.html"
];
let checked = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  let cursor = 0;
  while (true) {
    const start = html.indexOf("<script", cursor);
    if (start === -1) break;
    const openEnd = html.indexOf(">", start);
    const closeStart = html.indexOf("</script>", openEnd + 1);
    if (openEnd === -1 || closeStart === -1) {
      throw new Error("Unclosed script element in " + file);
    }
    const openingTag = html.slice(start, openEnd + 1);
    const source = html.slice(openEnd + 1, closeStart).trim();
    if (!openingTag.includes("src=") && source) {
      new vm.Script(source, { filename: file + "#inline-script-" + (checked + 1) });
      checked += 1;
    }
    cursor = closeStart + "</script>".length;
  }
}
console.log("Checked " + checked + " inline browser scripts across " + htmlFiles.length + " pages.");
